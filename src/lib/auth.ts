import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSession,
  cleanupExpiredAuthState,
  deleteSession,
  clearLoginAttempt,
  getLoginAttempt,
  getSessionByToken,
  recordLoginFailure,
  type Session,
} from "@/lib/db";

export const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
// IP 限流之外再加一层账户级限流，防止攻击者从多个地址轮换尝试。
const GLOBAL_LOGIN_KEY = "__admin_account__";
const GLOBAL_LOGIN_MAX_ATTEMPTS = 25;

function verifyPassword(password: string): boolean {
  const admin = process.env.ADMIN_PASSWORD;
  if (!admin) return false;
  // timingSafeEqual requires equal-length buffers. Hashing both inputs first
  // preserves a fixed comparison length without exposing the password length.
  const a = crypto.createHash("sha256").update(password, "utf8").digest();
  const b = crypto.createHash("sha256").update(admin, "utf8").digest();
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 校验密码，成功则创建会话并写入 httpOnly cookie */
export type LoginResult = { ok: true } | { ok: false; blocked: boolean; retryAfter?: number };

export async function login(password: string, options: { secure?: boolean; ip?: string } = {}): Promise<LoginResult> {
  // 生产环境若未显式开启 SESSION_COOKIE_SECURE，首次登录时提醒一次（HTTPS 反代尤其需要）。
  const warnedFlag = globalThis as unknown as { __warnedCookieSecure?: boolean };
  if (process.env.NODE_ENV === "production" && process.env.SESSION_COOKIE_SECURE !== "true" && !warnedFlag.__warnedCookieSecure) {
    warnedFlag.__warnedCookieSecure = true;
    console.warn("[auth] 生产环境未设置 SESSION_COOKIE_SECURE=true；使用 HTTPS 反代时请显式开启，以保证会话 cookie 携带 Secure 标记。");
  }
  // 直连或未配置可信代理时 IP 可能是 unknown，也必须纳入限流，不能绕过保护。
  const ip = options.ip?.trim() || "unknown";
  const now = Date.now();
  const existing = getLoginAttempt(ip);
  const globalExisting = getLoginAttempt(GLOBAL_LOGIN_KEY);
  const ipBlockedUntil = existing?.blocked_until ?? 0;
  const passwordMatches = verifyPassword(password);
  const globalBlockedUntil = globalExisting?.blocked_until ?? 0;
  if (!passwordMatches) {
    if (ipBlockedUntil > now) {
      return { ok: false, blocked: true, retryAfter: Math.ceil((ipBlockedUntil - now) / 1000) };
    }
    // The account-wide guard blocks distributed guessing, but an attacker must
    // not be able to use it to reject the administrator's correct password.
    if (globalBlockedUntil > now) {
      return { ok: false, blocked: true, retryAfter: Math.ceil((globalBlockedUntil - now) / 1000) };
    }
    const failure = recordLoginFailure(ip, {
      now,
      windowMs: LOGIN_WINDOW_MS,
      maxAttempts: LOGIN_MAX_ATTEMPTS,
      blockMs: LOGIN_BLOCK_MS,
    });
    const globalFailure = recordLoginFailure(GLOBAL_LOGIN_KEY, {
      now,
      windowMs: LOGIN_WINDOW_MS,
      maxAttempts: GLOBAL_LOGIN_MAX_ATTEMPTS,
      blockMs: LOGIN_BLOCK_MS,
    });
    const failureBlockedUntil = Math.max(failure.blockedUntil, globalFailure.blockedUntil);
    return failureBlockedUntil > now
      ? { ok: false, blocked: true, retryAfter: Math.ceil((failureBlockedUntil - now) / 1000) }
      : { ok: false, blocked: false };
  }

  clearLoginAttempt(ip);
  clearLoginAttempt(GLOBAL_LOGIN_KEY);
  cleanupExpiredAuthState(now);
  const token = crypto.randomBytes(32).toString("hex");
  createSession(token, Date.now() + SESSION_TTL_MS);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // 直接用 HTTP 局域网地址访问时不能强制 Secure，否则浏览器会拒收 Cookie；
    // 反向代理通过 x-forwarded-proto=https 时仍会安全地开启 Secure。
    secure: options.secure ?? process.env.SESSION_COOKIE_SECURE === "true",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
  return { ok: true };
}

/** 读取当前会话（含过期校验），未登录返回 null */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = getSessionByToken(token);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    deleteSession(token);
    return null;
  }
  return session;
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) deleteSession(token);
  store.delete(SESSION_COOKIE);
}

/** 页面/布局用：未登录跳转登录页 */
export async function requireAdmin(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/admin/login");
  return session;
}

/** API 用：未登录返回 null，由调用方返回 401 */
export async function requireAdminApi(request?: Request): Promise<Session | null> {
  return request ? requireAdminApiRequest(request) : getSession();
}

/** Cookie-authenticated write routes must prove same-origin intent. */
export async function requireAdminApiRequest(request: Request): Promise<Session | null> {
  const authorization = request.headers.get("authorization") ?? "";
  const configuredToken = process.env.ADMIN_API_TOKEN?.trim() ?? "";
  if (authorization.startsWith("Bearer ") && configuredToken.length >= 32) {
    const supplied = authorization.slice("Bearer ".length).trim();
    const a = crypto.createHash("sha256").update(supplied).digest();
    const b = crypto.createHash("sha256").update(configuredToken).digest();
    if (crypto.timingSafeEqual(a, b)) {
      return { id: "bearer", created_at: "", expires_at: Number.MAX_SAFE_INTEGER, generation: 0 };
    }
  }
  const session = await getSession();
  if (!session) return null;
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
    const { requestContentType, validateSameOriginWrite } = await import("@/lib/request-security");
    if (validateSameOriginWrite(request, { requireCsrfHeader: true })) return null;
    if (requestContentType(request) === "text/plain") return null;
  }
  return session;
}
