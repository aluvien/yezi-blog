import fs from "node:fs";
import path from "node:path";
import { getQQMusicSession } from "@/lib/qq-music-session";
import { findString, normalizeQQAudio, qqMusicRequest, unwrapData } from "@/lib/qq-music-api";
import { isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";

export type QQMusicHealthStatus = "healthy" | "missing_session" | "expired" | "unavailable" | "unverified";

export type QQMusicHealthResult = {
  status: QQMusicHealthStatus;
  checkedAt: string;
  detail: string;
};

export type QQMusicHealthAlertState = {
  lastStatus?: QQMusicHealthStatus;
  lastCheckedAt?: string;
  lastDetail?: string;
  lastNotifiedStatus?: QQMusicHealthStatus | "recovered";
  lastNotifiedAt?: string;
};

const FAILURE_STATUSES = new Set<QQMusicHealthStatus>(["missing_session", "expired", "unavailable"]);
const REPEAT_ALERT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PROBE_MID = "004a8wRo02vuxG";

function alertStatePath(): string {
  const dbPath = process.env.BLOG_DB_PATH?.trim();
  const dataDir = dbPath ? path.dirname(path.resolve(dbPath)) : path.join(process.cwd(), "data");
  return path.join(dataDir, "qq-music-alert-state.json");
}

function isHealthStatus(value: unknown): value is QQMusicHealthStatus {
  return value === "healthy" || value === "missing_session" || value === "expired" || value === "unavailable" || value === "unverified";
}

function isFailureStatus(value: unknown): value is QQMusicHealthStatus {
  return isHealthStatus(value) && FAILURE_STATUSES.has(value);
}

/** Read the small non-secret alert state saved alongside the SQLite database. */
export function getQQMusicHealthAlertState(): QQMusicHealthAlertState {
  try {
    const raw = JSON.parse(fs.readFileSync(alertStatePath(), "utf8")) as Partial<QQMusicHealthAlertState>;
    return {
      ...(isHealthStatus(raw.lastStatus) ? { lastStatus: raw.lastStatus } : {}),
      ...(typeof raw.lastCheckedAt === "string" ? { lastCheckedAt: raw.lastCheckedAt } : {}),
      ...(typeof raw.lastDetail === "string" ? { lastDetail: raw.lastDetail.slice(0, 240) } : {}),
      ...(isHealthStatus(raw.lastNotifiedStatus) || raw.lastNotifiedStatus === "recovered" ? { lastNotifiedStatus: raw.lastNotifiedStatus } : {}),
      ...(typeof raw.lastNotifiedAt === "string" ? { lastNotifiedAt: raw.lastNotifiedAt } : {}),
    };
  } catch {
    return {};
  }
}

function saveQQMusicHealthAlertState(state: QQMusicHealthAlertState): void {
  const destination = alertStatePath();
  const directory = path.dirname(destination);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = `${destination}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } finally {
    try { fs.unlinkSync(temporary); } catch { /* the atomic rename already consumed it */ }
  }
}

function probeMid(): string {
  const configured = process.env.QQ_MUSIC_HEALTH_CHECK_MID?.trim();
  return configured && /^[A-Za-z0-9_-]{6,80}$/.test(configured) ? configured : DEFAULT_PROBE_MID;
}

function isCookieFailure(message: string): boolean {
  return /cookie|登录|登入|失效|过期|expired|invalid\s*(?:cookie|session)|\buin\b/i.test(message);
}

/** Only connection/timeout failures mean the local sidecar is unavailable. */
function isServiceUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /fetch failed|econnrefused|econnreset|enotfound|network|timeout|timed out|aborted/i.test(message);
}

function statusLabel(status: QQMusicHealthStatus): string {
  switch (status) {
    case "healthy": return "正常";
    case "missing_session": return "未登录";
    case "expired": return "Cookie 已失效";
    case "unavailable": return "服务不可用";
    case "unverified": return "无法确认";
  }
}

/**
 * Check a real playback response rather than merely checking whether a local
 * cookie file exists. It does not modify login state or send notifications.
 */
export async function inspectQQMusicHealth(): Promise<QQMusicHealthResult> {
  const checkedAt = new Date().toISOString();
  if (!getQQMusicSession()) {
    return { status: "missing_session", checkedAt, detail: "服务器没有可用的 QQ 音乐登录会话" };
  }

  try {
    // The sidecar accepts `songmid` (lowercase), exactly like the front-end
    // player route. `songMID` happens to work on some releases but is rejected
    // as a bad request on others, which previously looked like an outage.
    const raw = await qqMusicRequest("/getMusicPlay", { query: { songmid: probeMid(), quality: "320" } });
    const data = unwrapData(raw);
    const audioUrl = normalizeQQAudio(findString(data, ["url", "purl", "play_url"]));
    if (audioUrl) return { status: "healthy", checkedAt, detail: "QQ 音乐播放授权正常" };

    const detail = findString(data, ["error", "message", "msg"]);
    if (detail && isCookieFailure(detail)) {
      return { status: "expired", checkedAt, detail: "QQ 音乐 Cookie 已失效，请重新扫码登录" };
    }
    return {
      status: "unverified",
      checkedAt,
      detail: detail ? `探测歌曲暂时不可播放：${detail.slice(0, 120)}` : "探测歌曲未返回播放地址",
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 120) : "未知错误";
    return {
      // A non-2xx response from the sidecar or QQ upstream is not proof that
      // the sidecar itself is down. Keep it visible for diagnosis but avoid a
      // false Telegram outage alert.
      status: isServiceUnavailable(error) ? "unavailable" : "unverified",
      checkedAt,
      detail: isServiceUnavailable(error) ? `无法连接 QQ 音乐服务：${detail}` : `播放授权探测未完成：${detail}`,
    };
  }
}

function shouldRepeatAlert(state: QQMusicHealthAlertState, status: QQMusicHealthStatus, now: number): boolean {
  if (state.lastNotifiedStatus !== status || !state.lastNotifiedAt) return true;
  const lastNotifiedAt = Date.parse(state.lastNotifiedAt);
  return !Number.isFinite(lastNotifiedAt) || now - lastNotifiedAt >= REPEAT_ALERT_MS;
}

/**
 * Persist every check, but only alert on a new failure (or once a day while it
 * remains broken). A successful playback after an alerted failure emits one
 * recovery message.
 */
export async function checkAndNotifyQQMusicHealth(): Promise<QQMusicHealthResult & { notified: boolean }> {
  const result = await inspectQQMusicHealth();
  const previous = getQQMusicHealthAlertState();
  const next: QQMusicHealthAlertState = {
    ...previous,
    lastStatus: result.status,
    lastCheckedAt: result.checkedAt,
    lastDetail: result.detail,
  };
  const now = Date.now();
  let notified = false;

  if (isTelegramConfigured() && isFailureStatus(result.status) && shouldRepeatAlert(previous, result.status, now)) {
    const sent = await sendTelegramMessage([
      "⚠️ QQ 音乐需要处理",
      `状态：${statusLabel(result.status)}`,
      `详情：${result.detail}`,
      "请到博客后台「设置 → 音乐设置」重新扫码登录。",
    ].join("\n"), {
      replyMarkup: {
        inline_keyboard: [[{ text: "发送 QQ 登录二维码", callback_data: "qq:login" }]],
      },
    });
    if (sent.ok) {
      next.lastNotifiedStatus = result.status;
      next.lastNotifiedAt = result.checkedAt;
      notified = true;
    }
  } else if (isTelegramConfigured() && result.status === "healthy" && isFailureStatus(previous.lastNotifiedStatus)) {
    const sent = await sendTelegramMessage("✅ QQ 音乐登录已恢复，播放器授权检测正常。");
    if (sent.ok) {
      next.lastNotifiedStatus = "recovered";
      next.lastNotifiedAt = result.checkedAt;
      notified = true;
    }
  }

  saveQQMusicHealthAlertState(next);
  return { ...result, notified };
}

export function qqMusicHealthStatusLabel(status: QQMusicHealthStatus): string {
  return statusLabel(status);
}
