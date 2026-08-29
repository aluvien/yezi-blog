import { site } from "@/lib/site";
import { TELEGRAM_SOURCE, withSource } from "@/lib/service-source";

type TelegramConfig = {
  token: string;
  chatId: string;
  adminUserId: string;
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

const TELEGRAM_BOT_COMMANDS = [
  { command: "start", description: "打开博客管理菜单" },
  { command: "dashboard", description: "查看站点数据概览" },
  { command: "comments", description: "查看和审核待审评论" },
  { command: "qqstatus", description: "检测 QQ 音乐播放授权" },
  { command: "qqlogin", description: "获取 QQ 音乐登录二维码" },
  { command: "qqmusiclogin", description: "用 QQ 音乐 App 扫码登录" },
  { command: "cancel", description: "取消当前回复或登录操作" },
  { command: "help", description: "查看可用指令" },
] as const;

type TelegramMessageOptions = {
  /** Defaults to the configured administrator chat. */
  chatId?: string;
  replyMarkup?: TelegramInlineKeyboard;
  parseMode?: "HTML";
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
  const adminUserId = process.env.TELEGRAM_ADMIN_USER_ID?.trim() ?? "";
  return token && chatId ? { token, chatId, adminUserId } : null;
}

/** Whether the server has enough private configuration to send notifications. */
export function isTelegramConfigured(): boolean {
  return config() !== null;
}

function isTelegramUserId(value: string): boolean {
  return /^\d{1,24}$/.test(value);
}

/**
 * 管理操作只允许管理员私聊发起：群组可以接收通知，但成员无法审核评论或接管 QQ 登录。
 * 未设置 TELEGRAM_ADMIN_USER_ID 时，只兼容“通知 Chat ID 就是管理员私聊 ID”的旧配置。
 */
export function isTelegramAdminUser(input: { chatId: string; chatType: string; userId: string }): boolean {
  const current = config();
  if (!current || input.chatType !== "private" || !isTelegramUserId(input.userId)) return false;
  if (current.adminUserId) return isTelegramUserId(current.adminUserId) && input.userId === current.adminUserId;
  return isTelegramUserId(current.chatId) && input.chatId === current.chatId && input.userId === current.chatId;
}

/** 只有默认通知目标本身就是管理员私聊时，才向该通知附带高权限操作按钮。 */
export function canManageFromNotificationChat(): boolean {
  const current = config();
  if (!current || !isTelegramUserId(current.chatId)) return false;
  return !current.adminUserId || (isTelegramUserId(current.adminUserId) && current.adminUserId === current.chatId);
}

function compactText(value: string, maxLength: number): string {
  const normalized = value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : normalized;
}

/** Escape dynamic data before it is interpolated into Telegram HTML messages. */
export function escapeTelegramHtml(value: string): string {
  return compactText(value, 3_800)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function telegramErrorMessage(description: string): string {
  if (/chat not found/i.test(description)) {
    return "Telegram 找不到这个 Chat ID：请先打开 Bot 私聊并发送 /start；若通知发往群组，请把 Bot 加入群组后填写该群组的 Chat ID。";
  }
  if (/unauthorized|bot token/i.test(description)) return "Telegram Bot Token 无效或已失效。";
  if (/bot was blocked by the user/i.test(description)) return "该聊天已屏蔽 Bot，请先在 Telegram 中解除屏蔽并发送 /start。";
  return withSource(compactText(description, 180), TELEGRAM_SOURCE);
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
    return { ok: false, configured: true, error: withSource("暂时无法连接 Telegram", TELEGRAM_SOURCE) };
  }
}

function isNotificationResult(value: { response: Response; data: TelegramApiResponse | null } | TelegramNotificationResult): value is TelegramNotificationResult {
  return "configured" in value;
}

function requestResult(result: { response: Response; data: TelegramApiResponse | null } | TelegramNotificationResult): TelegramNotificationResult {
  if (isNotificationResult(result)) return result;
  if (!result.response.ok || result.data?.ok !== true) {
    const description = typeof result.data?.description === "string" ? result.data.description.trim() : "Telegram 服务未接受通知";
    return { ok: false, configured: true, error: withSource(telegramErrorMessage(description), TELEGRAM_SOURCE) };
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
      ...(options.parseMode ? { parse_mode: options.parseMode } : {}),
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
    const description = withSource(
      typeof result.data?.description === "string" ? telegramErrorMessage(result.data.description) : "无法读取 Telegram 指令",
      TELEGRAM_SOURCE,
    );
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

/** Register Telegram's native command menu once for the configured Bot. */
export async function registerTelegramBotCommands(): Promise<void> {
  // 旧版本注册在默认范围，群组也会显示菜单。先清理默认范围，再仅为私聊注册。
  const clearResult = await telegramRequest("deleteMyCommands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scope: { type: "default" } }),
  });
  requestResult(clearResult);
  const result = await telegramRequest("setMyCommands", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ commands: TELEGRAM_BOT_COMMANDS, scope: { type: "all_private_chats" } }),
  });
  // A transient Telegram failure must not stop command polling or the blog.
  requestResult(result);
}

/** New comments are always pending first, so the message leads to moderation. */
export async function notifyNewComment(input: TelegramCommentNotification): Promise<TelegramNotificationResult> {
  const targetType = input.targetType === "post" ? "文章" : "想法";
  return sendTelegramMessage([
    "<b>💬 新评论待审核</b>",
    "",
    `<b>作者</b>　${escapeTelegramHtml(input.nickname)}`,
    `<b>位置</b>　${targetType} · ${escapeTelegramHtml(input.targetLabel || "未命名内容")}`,
    "",
    `<blockquote>${escapeTelegramHtml(input.content)}</blockquote>`,
    "",
    `<a href=\"${site.url}/admin/comments\">进入后台审核 →</a>`,
  ].join("\n"), {
    parseMode: "HTML",
    ...(canManageFromNotificationChat() ? { replyMarkup: { inline_keyboard: [[{ text: "通过", callback_data: `comment:approve:${input.commentId}` }, { text: "回复并通过", callback_data: `comment:reply:${input.commentId}` }]] } } : {}),
  });
}

export async function sendTelegramTestNotification(): Promise<TelegramNotificationResult> {
  return sendTelegramMessage([
    "<b>✅ 博客 Telegram 已连接</b>",
    "",
    "新评论审核与 QQ 音乐状态会推送到这里。",
    "发送 <code>/qqlogin</code> 可用 QQ 扫码；发送 <code>/qqmusiclogin</code> 可用 QQ 音乐 App 扫码。",
  ].join("\n"), { parseMode: "HTML" });
}
