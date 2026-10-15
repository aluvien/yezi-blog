import { currentDataEpoch } from "@/lib/cloud-restore-guard";
import { getQQMusicSession, updateQQMusicSession, type QQMusicSession } from "@/lib/qq-music-session";
import { nativeQQMusicComm, qqMusicCredentialCookie } from "@/lib/qq-music-native-login";

type Credential = Record<string, unknown>;
type AccountStatus = "valid" | "expired" | "unverified" | "unavailable";
export type QQMusicAccountCheck = { status: AccountStatus; code?: number };
const REJECTED_CODES = new Set([1000, 104400, 104401]);
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const REFRESH_RETRY_MS = 30 * 60 * 1000;

function record(value: unknown): Credential {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Credential : {};
}

function cookieValues(cookie: string): Record<string, string> {
  return Object.fromEntries(cookie.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    return separator > 0 ? [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]] : [];
  }));
}

function credentialFor(session: QQMusicSession): Credential {
  if (session.nativeAuth) return session.nativeAuth.credential;
  const cookies = cookieValues(session.cookie);
  return {
    musicid: session.uin,
    musickey: cookies.qm_keyst || cookies.qqmusic_key || "",
    loginType: Number(cookies.tmeLoginType || "2"),
    ...(session.credential ?? {}),
  };
}

export function qqMusicCredentialExpiresAt(credential: Credential): number | null {
  const seconds = (value: unknown): number | null => {
    if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value.trim()))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  };
  const created = seconds(credential.musickeyCreateTime);
  const lifetime = seconds(credential.keyExpiresIn);
  if (created === null || lifetime === null) return null;
  const expiresAt = (created + lifetime) * 1000;
  return Number.isSafeInteger(expiresAt) && Number.isFinite(new Date(expiresAt).getTime()) ? expiresAt : null;
}

/** Only upstream credential timing describes login expiry; nativeAuth.expiresAt is a local session TTL. */
export function qqMusicSessionExpiresAt(session: QQMusicSession | null): string | null {
  if (!session) return null;
  const expiresAt = qqMusicCredentialExpiresAt(session.nativeAuth?.credential ?? session.credential ?? {});
  return expiresAt === null ? null : new Date(expiresAt).toISOString();
}

class CredentialRequestError extends Error {
  readonly status: "expired" | "unverified" | "unavailable";
  readonly code?: number;
  constructor(status: "expired" | "unverified" | "unavailable", code?: number) {
    super(`QQ 音乐账号接口${status === "expired" ? "拒绝凭据" : status === "unavailable" ? "连接失败" : "校验未完成"}${code === undefined ? "" : `（${code}）`}`);
    this.status = status;
    this.code = code;
  }
}

async function musicu(session: QQMusicSession, module: string, method: string, param: Credential): Promise<Credential> {
  const credential = credentialFor(session);
  const comm = session.nativeAuth ? nativeQQMusicComm(session.nativeAuth) : {
    ct: 24, cv: 0, format: "json", uin: session.uin, authst: credential.musickey,
    tmeLoginType: credential.loginType,
  };
  let response: Response;
  try {
    response = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST", cache: "no-store",
      headers: {
        "Content-Type": "application/json", Cookie: session.cookie, Referer: "https://y.qq.com/",
        ...(session.nativeAuth ? { "User-Agent": `QQMusic 14090008(android ${session.nativeAuth.device.osRelease})` } : {}),
      },
      body: JSON.stringify({ comm, req_0: { module, method, param } }),
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new CredentialRequestError("unavailable");
  }
  if (!response.ok) throw new CredentialRequestError("unverified");
  let body: Credential;
  try { body = record(await response.json()); } catch { throw new CredentialRequestError("unverified"); }
  const item = record(body.req_0);
  for (const code of [body.code, item.code]) {
    if (typeof code !== "number") throw new CredentialRequestError("unverified");
    if (code !== 0) throw new CredentialRequestError(REJECTED_CODES.has(code) ? "expired" : "unverified", code);
  }
  const data = record(item.data);
  if (!Object.keys(data).length) throw new CredentialRequestError("unverified");
  return data;
}

export async function inspectQQMusicAccount(session: QQMusicSession): Promise<QQMusicAccountCheck> {
  try {
    await musicu(session, "music.UserInfo.userInfoServer", "GetLoginUserInfo", {});
    return { status: "valid" };
  } catch (error) {
    return error instanceof CredentialRequestError ? { status: error.status, code: error.code } : { status: "unverified" };
  }
}

function refreshParameters(session: QQMusicSession): Credential {
  const credential = credentialFor(session);
  const parameters: Credential = { loginMode: 2, musickey: credential.musickey };
  for (const key of ["openid", "access_token", "refresh_token", "refresh_key", "unionid"]) {
    parameters[key] = typeof credential[key] === "string" ? credential[key] : "";
  }
  if (Number(credential.loginType) !== 1) {
    parameters.musicid = Number(session.uin);
    parameters.expired_in = Number(credential.expired_in ?? credential.expires_in ?? 0);
  }
  if (Number(credential.loginType) !== 2) parameters.str_musicid = session.uin;
  return parameters;
}

async function maintainSession(): Promise<{ refreshed: boolean }> {
  const epoch = currentDataEpoch();
  const session = getQQMusicSession();
  if (!session) return { refreshed: false };
  const now = Date.now();
  const lastAttempt = Date.parse(session.lastRefreshAttemptAt ?? "");
  if (Number.isFinite(lastAttempt) && now - lastAttempt < REFRESH_RETRY_MS) return { refreshed: false };
  const account = await inspectQQMusicAccount(session);
  const expiry = qqMusicCredentialExpiresAt(credentialFor(session));
  const lastRefresh = Date.parse(session.refreshedAt || session.updatedAt);
  const due = (expiry !== null && expiry - now <= 24 * 60 * 60 * 1000)
    || !Number.isFinite(lastRefresh) || now - lastRefresh >= REFRESH_INTERVAL_MS;
  if (account.status !== "expired" && !(account.status === "valid" && due)) return { refreshed: false };
  const attemptedAt = new Date(now).toISOString();
  try {
    const refreshed = await musicu(session, "music.login.LoginServer", "Login", refreshParameters(session));
    const previous = credentialFor(session);
    const returnedId = refreshed.str_musicid || refreshed.musicid;
    if (!returnedId || String(returnedId) !== session.uin || typeof refreshed.musickey !== "string" || !refreshed.musickey) throw new CredentialRequestError("unverified");
    const credential = { ...previous, ...refreshed };
    const keyChanged = refreshed.musickey !== previous.musickey;
    // Timing fields belong together and to one key. Never carry an old key's expiry into a new login.
    if (keyChanged || "musickeyCreateTime" in refreshed || "keyExpiresIn" in refreshed) {
      delete credential.musickeyCreateTime;
      delete credential.keyExpiresIn;
      if (qqMusicCredentialExpiresAt(refreshed) !== null) {
        credential.musickeyCreateTime = refreshed.musickeyCreateTime;
        credential.keyExpiresIn = refreshed.keyExpiresIn;
      }
    }
    const login = qqMusicCredentialCookie(credential);
    if (!login || login.uin !== session.uin) throw new CredentialRequestError("unverified");
    const renewedExpiry = qqMusicCredentialExpiresAt(credential)
      ?? (keyChanged ? now + 24 * 60 * 60 * 1000 : null);
    if (renewedExpiry !== null && renewedExpiry <= now) throw new CredentialRequestError("unverified");
    const candidate: QQMusicSession = {
      ...session, ...login, credential,
      cookie: Object.entries({ ...cookieValues(session.cookie), ...cookieValues(login.cookie) }).map(([name, value]) => `${name}=${value}`).join("; "),
      ...(session.nativeAuth ? { nativeAuth: {
        ...session.nativeAuth, credential,
        expiresAt: renewedExpiry ?? session.nativeAuth.expiresAt,
      } } : {}),
    };
    if ((await inspectQQMusicAccount(candidate)).status !== "valid") throw new CredentialRequestError("unverified");
    return { refreshed: updateQQMusicSession(session, {
      cookie: candidate.cookie, credential, nativeAuth: candidate.nativeAuth,
      refreshedAt: attemptedAt, lastRefreshAttemptAt: attemptedAt,
    }, epoch) };
  } catch {
    updateQQMusicSession(session, { lastRefreshAttemptAt: attemptedAt }, epoch);
    return { refreshed: false };
  }
}

type RenewalGlobal = typeof globalThis & { __yeziQQMusicRenewal?: Promise<{ refreshed: boolean }> };

export function maintainQQMusicSession(): Promise<{ refreshed: boolean }> {
  const current = globalThis as RenewalGlobal;
  if (!current.__yeziQQMusicRenewal) {
    current.__yeziQQMusicRenewal = maintainSession().finally(() => { delete current.__yeziQQMusicRenewal; });
  }
  return current.__yeziQQMusicRenewal;
}
