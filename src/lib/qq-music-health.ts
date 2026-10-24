import { currentDataEpoch, dataWriteRejection } from "@/lib/cloud-restore-guard";
import fs from "node:fs";
import path from "node:path";
import { getQQMusicSession } from "@/lib/qq-music-session";
import { findString, normalizeQQAudio, qqMusicRequest, unwrapData } from "@/lib/qq-music-api";
import { canManageFromNotificationChat, escapeTelegramHtml, isTelegramConfigured, sendTelegramMessage } from "@/lib/telegram";
import { QQ_MUSIC_WEB_SOURCE, withSource } from "@/lib/service-source";
import { inspectQQMusicAccount } from "@/lib/qq-music-credential";
import { notifyMusicPushHealth, drainPushOutbox } from "@/lib/ios-push";

export type QQMusicHealthStatus = "healthy" | "missing_session" | "expired" | "unavailable" | "unverified" | "playback_unavailable";

export type QQMusicHealthResult = {
  status: QQMusicHealthStatus;
  checkedAt: string;
  detail: string;
  authenticated: boolean | null;
  playable: boolean;
  sessionVersion?: string;
};

export type QQMusicHealthAlertState = {
  lastStatus?: QQMusicHealthStatus;
  lastCheckedAt?: string;
  lastDetail?: string;
  lastNotifiedStatus?: QQMusicHealthStatus | "recovered";
  lastNotifiedAt?: string;
  sessionVersion?: string;
};

// A health check is meaningful only when it obtained an actual playable URL.
// “Unverified” therefore requires attention too: it covers an upstream response
// without a URL and protocol errors that are not a proven local-sidecar outage.
const FAILURE_STATUSES = new Set<QQMusicHealthStatus>(["missing_session", "expired", "unavailable", "unverified", "playback_unavailable"]);
const REPEAT_ALERT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PROBE_MID = "004a8wRo02vuxG";

function alertStatePath(): string {
  const dbPath = process.env.BLOG_DB_PATH?.trim();
  const dataDir = dbPath ? path.dirname(path.resolve(dbPath)) : path.join(process.cwd(), "data");
  return path.join(dataDir, "qq-music-alert-state.json");
}

function isHealthStatus(value: unknown): value is QQMusicHealthStatus {
  return value === "healthy" || value === "missing_session" || value === "expired" || value === "unavailable" || value === "unverified" || value === "playback_unavailable";
}

export function qqMusicHealthNeedsAttention(value: unknown): value is QQMusicHealthStatus {
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
      ...(typeof raw.sessionVersion === "string" ? { sessionVersion: raw.sessionVersion } : {}),
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

/** Only connection/timeout failures mean the local sidecar is unavailable. */
function isServiceUnavailable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /fetch failed|econnrefused|econnreset|enotfound|network|timeout|timed out|aborted/i.test(message);
}

function statusLabel(status: QQMusicHealthStatus): string {
  switch (status) {
    case "healthy": return "正常";
    case "missing_session": return "未登录";
    case "expired": return "登录已失效";
    case "unavailable": return "服务不可用";
    case "unverified": return "无法确认";
    case "playback_unavailable": return "已登录 · 播放异常";
  }
}

/**
 * Check a real playback response rather than merely checking whether a local
 * cookie file exists. It does not modify login state or send notifications.
 */
export async function inspectQQMusicHealth(): Promise<QQMusicHealthResult> {
  const checkedAt = new Date().toISOString();
  const session = getQQMusicSession();
  if (!session) {
    return { status: "missing_session", checkedAt, authenticated: false, playable: false, detail: withSource("服务器没有可用的 QQ 音乐登录会话", QQ_MUSIC_WEB_SOURCE) };
  }
  const account = await inspectQQMusicAccount(session);
  const base = { checkedAt, authenticated: account.status === "valid" ? true : account.status === "expired" ? false : null, playable: false, sessionVersion: session.revision || session.updatedAt };
  if (account.status === "expired") {
    return { ...base, status: "expired", detail: withSource("QQ 音乐已拒绝当前登录凭据；自动续期若未恢复，请重新扫码", QQ_MUSIC_WEB_SOURCE) };
  }
  try {
    // The sidecar accepts `songmid` (lowercase), exactly like the front-end
    // player route. `songMID` happens to work on some releases but is rejected
    // as a bad request on others, which previously looked like an outage.
    const raw = await qqMusicRequest("/getMusicPlay", { query: { songmid: probeMid(), quality: "320" } });
    const data = unwrapData(raw);
    const audioUrl = normalizeQQAudio(findString(data, ["url", "purl", "play_url"]));
    if (/^https?:\/\//i.test(audioUrl)) {
      return account.status === "valid"
        ? { ...base, playable: true, status: "healthy", detail: "QQ 音乐账号校验与播放检测正常" }
        : { ...base, playable: true, status: "unverified", detail: "歌曲可以播放，账号校验暂未完成；暂不需要重新扫码" };
    }
    return {
      ...base,
      status: account.status === "valid" ? "playback_unavailable" : "unverified",
      detail: withSource(account.status === "valid"
        ? "账号登录有效，探测歌曲未返回播放地址，请检查歌曲授权或音乐服务接口"
        : "账号校验与播放检测暂未完成，尚不能判断登录失效", QQ_MUSIC_WEB_SOURCE),
    };
  } catch (error) {
    return {
      // A non-2xx response from the sidecar or QQ upstream is not proof that
      // the sidecar itself is down, but it still means playback was not
      // verified and must be surfaced through the Telegram health alert.
      status: isServiceUnavailable(error) ? "unavailable" : "unverified",
      ...base,
      detail: withSource(`${account.status === "valid" ? "账号登录有效；" : ""}${isServiceUnavailable(error) ? "无法连接 QQ 音乐播放服务，请检查服务或网络" : "播放检测未完成，请检查音乐服务接口"}`, QQ_MUSIC_WEB_SOURCE),
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
  const epoch = currentDataEpoch();
  const result = await inspectQQMusicHealth();
  if (dataWriteRejection(epoch)) return { ...result, notified: false };
  const currentSession = getQQMusicSession();
  if ((currentSession?.revision || currentSession?.updatedAt) !== result.sessionVersion) return { ...result, notified: false };
  const previous = getQQMusicHealthAlertState();
  const next: QQMusicHealthAlertState = {
    ...previous,
    lastStatus: result.status,
    lastCheckedAt: result.checkedAt,
    lastDetail: result.detail,
    sessionVersion: result.sessionVersion,
  };
  const now = Date.now();
  let notified = false;
  const needsLogin = result.status === "missing_session" || result.status === "expired";
  try { notifyMusicPushHealth(result.status, result.sessionVersion, previous.sessionVersion); }
  catch { console.warn("[push] music notification could not be queued"); }

  if (isTelegramConfigured() && qqMusicHealthNeedsAttention(result.status) && shouldRepeatAlert(previous, result.status, now)) {
    const sent = await sendTelegramMessage([
      "<b>⚠️ QQ 音乐需要处理</b>",
      "",
      `<b>状态</b>　${statusLabel(result.status)}`,
      `<b>诊断</b>　${escapeTelegramHtml(result.detail)}`,
      "",
      needsLogin
        ? canManageFromNotificationChat() ? "可在下方直接获取登录二维码。" : "请在与 Bot 的管理员私聊中发送 /qqlogin 获取登录二维码。"
        : "请检查音乐服务或歌曲授权；此次检测不代表登录已失效。",
    ].join("\n"), {
      parseMode: "HTML",
      ...(needsLogin && canManageFromNotificationChat() ? { replyMarkup: {
        inline_keyboard: [
          [{ text: "发送 QQ 登录二维码", callback_data: "qq:login" }],
          [{ text: "发送 QQ 音乐 App 二维码", callback_data: "qqmusic:login" }],
        ],
      } } : {}),
    });
    if (sent.ok) {
      next.lastNotifiedStatus = result.status;
      next.lastNotifiedAt = result.checkedAt;
      notified = true;
    }
  } else if (isTelegramConfigured() && result.status === "healthy" && qqMusicHealthNeedsAttention(previous.lastNotifiedStatus)) {
    const sent = await sendTelegramMessage("<b>✅ QQ 音乐已恢复</b>\n\n播放器授权检测正常。", { parseMode: "HTML" });
    if (sent.ok) {
      next.lastNotifiedStatus = "recovered";
      next.lastNotifiedAt = result.checkedAt;
      notified = true;
    }
  }

  if (!dataWriteRejection(epoch)) saveQQMusicHealthAlertState(next);
  if (!dataWriteRejection(epoch)) await drainPushOutbox().catch(() => {});
  return { ...result, notified };
}

export function qqMusicHealthStatusLabel(status: QQMusicHealthStatus): string {
  return statusLabel(status);
}

/**
 * 上一次健康检查是否已经证明登录态不可用。
 *
 * 音频缓存的降级播放用它做短路：Cookie 失效时实时解析必然失败，而
 * qqMusicRequest 的超时是 12 秒，不短路会让访客白等一次注定失败的请求。
 * 只认「未登录」和「Cookie 已失效」两种状态；服务不可用属于另一类故障，
 * 那条路径通常立即失败，交给正常的 try/fallback 处理即可。
 */
export function qqMusicSessionKnownInvalid(): boolean {
  const session = getQQMusicSession();
  const alert = getQQMusicHealthAlertState();
  if (!session) return alert.lastStatus === "missing_session" || alert.lastStatus === "expired";
  return alert.sessionVersion === (session.revision || session.updatedAt) && alert.lastStatus === "expired";
}
