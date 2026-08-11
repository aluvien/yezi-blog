import { site } from "@/lib/site";

type TelegramConfig = {
  token: string;
  chatId: string;
};

type TelegramApiResponse = {
  ok?: boolean;
  description?: unknown;
};

export type TelegramNotificationResult = {
  ok: boolean;
  configured: boolean;
  error?: string;
};

export type TelegramCommentNotification = {
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

function compactText(value: string, maxLength: number): string {
  const normalized = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…` : normalized;
}

/**
 * Send a plain-text message without ever exposing Telegram credentials to a
 * browser, the database, or a caller. Telegram errors are normalized so route
 * handlers can safely show them to an administrator.
 */
export async function sendTelegramMessage(text: string): Promise<TelegramNotificationResult> {
  const current = config();
  if (!current) return { ok: false, configured: false, error: "尚未配置 Telegram 通知" };

  try {
    const response = await fetch(`https://api.telegram.org/bot${current.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: current.chatId, text: compactText(text, 3800), disable_web_page_preview: true }),
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    const data = await response.json().catch(() => null) as TelegramApiResponse | null;
    if (!response.ok || data?.ok !== true) {
      const description = typeof data?.description === "string" ? data.description.trim() : "Telegram 服务未接受通知";
      return { ok: false, configured: true, error: compactText(description, 180) };
    }
    return { ok: true, configured: true };
  } catch {
    return { ok: false, configured: true, error: "暂时无法连接 Telegram" };
  }
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
  ].join("\n"));
}

export async function sendTelegramTestNotification(): Promise<TelegramNotificationResult> {
  return sendTelegramMessage([
    "✅ 博客 Telegram 通知已连接",
    "新评论审核与 QQ 音乐登录状态检测会推送到这里。",
  ].join("\n"));
}
