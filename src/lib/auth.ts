import crypto from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  getSessionByToken,
  type Session,
} from "@/lib/db";

export const SESSION_COOKIE = "admin_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function verifyPassword(password: string): boolean {
  const admin = process.env.ADMIN_PASSWORD;
  if (!admin) return false;
  const a = Buffer.from(password);
  const b = Buffer.from(admin);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** 校验密码，成功则创建会话并写入 httpOnly cookie */
export async function login(password: string, options: { secure?: boolean } = {}): Promise<boolean> {
  if (!verifyPassword(password)) return false;
  deleteExpiredSessions();
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
  return true;
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
export async function requireAdminApi(): Promise<Session | null> {
  return getSession();
}
