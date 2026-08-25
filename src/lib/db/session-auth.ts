// 管理员会话 + 登录保护 DAO。
import { db, now } from "./core";
import { hashIp } from "@/lib/ip-hash";
import type { Session, LoginAttempt } from "./types";

const LOGIN_ATTEMPT_RETENTION_MS = 24 * 60 * 60 * 1000;

function hashSessionToken(token: string): string {
  return hashIp(token);
}

export function createSession(token: string, expiresAt: number): void {
  const hashedToken = hashSessionToken(token);
  db.prepare("INSERT INTO sessions (id, created_at, expires_at, generation) VALUES (?, ?, ?, ?)")
    .run(hashedToken, now(), expiresAt, getSessionGeneration());
}

export function getSessionGeneration(): number {
  const row = db.prepare("SELECT session_generation FROM auth_state WHERE singleton = 1").get() as { session_generation: number } | undefined;
  return Math.max(1, Number(row?.session_generation) || 1);
}

/** Revoke every existing session without exposing or rewriting stored tokens. */
export function revokeAllSessions(): number {
  return db.transaction(() => {
    const next = getSessionGeneration() + 1;
    db.prepare("UPDATE auth_state SET session_generation = ?, updated_at = ? WHERE singleton = 1").run(next, now());
    db.prepare("DELETE FROM sessions").run();
    return next;
  })();
}

export function getSessionByToken(token: string): Session | undefined {
  const hashedToken = hashSessionToken(token);
  const hashed = db.prepare("SELECT * FROM sessions WHERE id = ?").get(hashedToken) as Session | undefined;
  if (hashed) return hashed.generation === getSessionGeneration() ? hashed : undefined;
  // 兼容升级前已经存在的明文会话；首次使用时立即迁移为哈希存储。
  const legacy = db.prepare("SELECT * FROM sessions WHERE id = ?").get(token) as Session | undefined;
  if (!legacy) return undefined;
  const migrate = db.transaction(() => {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
    db.prepare("INSERT OR REPLACE INTO sessions (id, created_at, expires_at, generation) VALUES (?, ?, ?, ?)")
      .run(hashedToken, legacy.created_at, legacy.expires_at, getSessionGeneration());
  });
  migrate();
  return { ...legacy, id: hashedToken, generation: getSessionGeneration() };
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE id IN (?, ?)").run(token, hashSessionToken(token));
}

export function deleteExpiredSessions(referenceTime = Date.now()): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(referenceTime);
}

/** Login failures are transient abuse-control state, not an activity archive. */
export function deleteExpiredLoginAttempts(referenceTime = Date.now()): void {
  db.prepare("DELETE FROM login_attempts WHERE first_failed_at < ?").run(referenceTime - LOGIN_ATTEMPT_RETENTION_MS);
}

/** Safe to run at startup, before a backup, and after a successful login. */
export function cleanupExpiredAuthState(referenceTime = Date.now()): void {
  db.transaction(() => {
    deleteExpiredSessions(referenceTime);
    deleteExpiredLoginAttempts(referenceTime);
  })();
}

// ---------- login protection ----------

// login_attempts 只保存来源地址的 sha256 哈希（与 comments 一致），
// 避免明文留存客户端 IP；限流判定依赖哈希确定性，行为不变。
export function getLoginAttempt(key: string): LoginAttempt | undefined {
  return db.prepare("SELECT * FROM login_attempts WHERE ip = ?").get(hashIp(key)) as LoginAttempt | undefined;
}

export function recordLoginFailure(
  key: string,
  options: { now: number; windowMs: number; maxAttempts: number; blockMs: number },
): { failedCount: number; blockedUntil: number } {
  const hashedKey = hashIp(key);
  const existing = getLoginAttempt(key);
  if (!existing || options.now - existing.first_failed_at >= options.windowMs) {
    db.prepare(
      `INSERT INTO login_attempts (ip, failed_count, first_failed_at, blocked_until)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(ip) DO UPDATE SET failed_count = 1, first_failed_at = excluded.first_failed_at, blocked_until = 0`,
    ).run(hashedKey, options.now);
    return { failedCount: 1, blockedUntil: 0 };
  }

  const failedCount = existing.failed_count + 1;
  const blockedUntil = failedCount >= options.maxAttempts ? options.now + options.blockMs : existing.blocked_until;
  db.prepare("UPDATE login_attempts SET failed_count = ?, blocked_until = ? WHERE ip = ?").run(
    failedCount,
    blockedUntil,
    hashedKey,
  );
  return { failedCount, blockedUntil };
}

export function clearLoginAttempt(key: string): void {
  db.prepare("DELETE FROM login_attempts WHERE ip = ?").run(hashIp(key));
}
