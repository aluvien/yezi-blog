import { site } from "@/lib/site";

type TelegramConfig = {
  token: string;
  chatId: string;
};

type TelegramApiResponse = {
  ok?: boolean;
  description?: unknown;
  result?: unknown;
};

export type TelegramNotificationResult = {
  ok: boolean;
  configured: boolean;
  error?: string;
};

export type TelegramInlineKeyboard = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type TelegramMessageOptions = {
  /** Defaults to the configured administrator chat. */
  chatId?: string;
  replyMarkup?: TelegramInlineKeyboard;
};

export type TelegramCommentNotification = {
  commentId: number;
  nickname: string;
  content: string;
  targetType: "post" | "moment";
  targetLabel: string;
};

function config(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
  const chatId = process.env.TELEGRAM_CHAT_ID?.trim() ?? "";
  return token && chatId ? { token, chatId } : null;
}

/** Whether the server has enough private configuration to send notifications. */
export function isTelegramConfigured(): boolean {
  return config() !== null;
}

/** Callback commands are accepted only from the configured administrator chat. */
export function isTelegramAdminChat(chatId: string): boolean {
  return Boolean(chatId) && config()?.chatId === chatId;
}

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : normalized;
}

function telegramErrorMessage(description: string): string {
  if (/chat not found/i.test(description)) {
    return "Telegram 找不到这个 Chat ID：请先打开 Bot 私聊并发送 /start；若通知发往群组，请把 Bot 加入群组后填写该群组的 Chat ID。";
  }
  if (/unauthorized|bot token/i.test(description)) return "Telegram Bot Token 无效或已失效。";
  if (/bot was blocked by the user/i.test(description)) return "该聊天已屏蔽 Bot，请先在 Telegram 中解除屏蔽并发送 /start。";
  return compactText(description, 180);
}

async function telegramRequest(method: string, init: RequestInit): Promise<{ response: Response; data: TelegramApiResponse | null } | TelegramNotificationResult> {
  const current = config();
  if (!current) return { ok: false, configured: false, error: "尚未配置 Telegram 通知" };
  try {
    const response = await fetch(`https://api.telegram.org/bot${current.token}/${method}`, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    const data = await response.json().catch(() => null) as TelegramApiResponse | null;
    return { response, data };
  } catch {
    return { ok: false, configured: true, error: "暂时无法连接 Telegram" };
  }
}

function isNotificationResult(value: { response: Response; data: TelegramApiResponse | null } | TelegramNotificationResult): value is TelegramNotificationResult {
  return "configured" in value;
}

function requestResult(result: { response: Response; data: TelegramApiResponse | null } | TelegramNotificationResult): TelegramNotificationResult {
  if (isNotificationResult(result)) return result;
  if (!result.response.ok || result.data?.ok !== true) {
    const description = typeof result.data?.description === "string" ? result.data.description.trim() : "Telegram 服务未接受通知";
    return { ok: false, configured: true, error: telegramErrorMessage(description) };
  }
  return { ok: true, configured: true };
}

/**
 * Send a plain-text message without ever exposing Telegram credentials to a
 * browser, the database, or a caller. Telegram errors are normalized so route
 * handlers can safely show them to an administrator.
 */
export async function sendTelegramMessage(text: string, options: TelegramMessageOptions = {}): Promise<TelegramNotificationResult> {
  const current = config();
  if (!current) return { ok: false, configured: false, error: "尚未配置 Telegram 通知" };
  const result = await telegramRequest("sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: options.chatId ?? current.chatId,
      text: compactText(text, 3800),
      disable_web_page_preview: true,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    }),
  });
  return requestResult(result);
}

/** Send the locally generated QQ QR image without making it public on the web. */
export async function sendTelegramPhoto(chatId: string, image: string, caption: string): Promise<TelegramNotificationResult> {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(image);
  if (!match) return { ok: false, configured: isTelegramConfigured(), error: "QQ 音乐二维码格式无效" };
  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", compactText(caption, 900));
  form.set("photo", new Blob([Buffer.from(match[2].replace(/\s/g, ""), "base64")], { type: match[1] }), "qq-music-login.png");
  const result = await telegramRequest("sendPhoto", { method: "POST", body: form });
  return requestResult(result);
}

/** Read Bot commands and inline button callbacks without exposing the token. */
export async function getTelegramUpdates(offset?: number): Promise<{ ok: true; updates: unknown[] } | { ok: false; error: string }> {
  const query = new URLSearchParams({ timeout: "0", allowed_updates: JSON.stringify(["message", "callback_query"]) });
  if (Number.isInteger(offset) && (offset as number) > 0) query.set("offset", String(offset));
  const result = await telegramRequest(`getUpdates?${query.toString()}`, { method: "GET" });
  if (isNotificationResult(result)) return { ok: false, error: result.error ?? "无法读取 Telegram 指令" };
  if (!result.response.ok || result.data?.ok !== true || !Array.isArray(result.data.result)) {
    const description = typeof result.data?.description === "string" ? telegramErrorMessage(result.data.description) : "无法读取 Telegram 指令";
    return { ok: false, error: description };
  }
  return { ok: true, updates: result.data.result };
}

export async function answerTelegramCallback(callbackId: string, text: string): Promise<void> {
  if (!callbackId) return;
  await telegramRequest("answerCallbackQuery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackId, text: compactText(text, 180), show_alert: false }),
  });
}

/** New comments are always pending first, so the message leads to moderation. */
export async function notifyNewComment(input: TelegramCommentNotification): Promise<TelegramNotificationResult> {
  const targetType = input.targetType === "post" ? "文章" : "想法";
  return sendTelegramMessage([
    "💬 博客有一条新评论待审核",
    `作者：${compactText(input.nickname, 80)}`,
    `位置：${targetType} · ${compactText(input.targetLabel, 100) || "未命名内容"}`,
    `内容：${compactText(input.content, 500)}`,
    `管理：${site.url}/admin/comments`,
  ].join("\n"), {
    replyMarkup: {
      inline_keyboard: [[
        { text: "通过", callback_data: `comment:approve:${input.commentId}` },
        { text: "回复并通过", callback_data: `comment:reply:${input.commentId}` },
      ]],
    },
  });
}

export async function sendTelegramTestNotification(): Promise<TelegramNotificationResult> {
  return sendTelegramMessage([
    "✅ 博客 Telegram 通知已连接",
    "新评论审核与 QQ 音乐登录状态检测会推送到这里。",
    "发送 /qqlogin 可直接接收 QQ 音乐授权二维码。",
  ].join("\n"));
}
