// 管理员会话 + 登录保护 DAO。
import crypto from "node:crypto";
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

const FINGERPRINT_PATTERN = /^v1:[0-9a-f]{32}:[0-9a-f]{128}$/;

/**
 * 指纹必须与 verifyPassword() 使用完全相同的输入：原始 process.env.ADMIN_PASSWORD，
 * 不 trim——否则 "password" → "password " 会被登录视为改密、被指纹视为未变。
 * 派生用 scrypt（内存硬化、单次启动开销可忽略），不用裸 SHA-256：
 * 数据库/备份泄露时不应多出一个可离线高速爆破的管理员口令校验器。
 */
function fingerprintWith(salt: string, password: string): string {
  const derived = crypto.scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
  return `v1:${salt}:${derived}`;
}

function matchesFingerprint(stored: string, password: string): boolean {
  const [, salt, key] = stored.split(":");
  const candidate = crypto.scryptSync(password, Buffer.from(salt, "hex"), 64);
  const expected = Buffer.from(key, "hex");
  return expected.length === candidate.length && crypto.timingSafeEqual(expected, candidate);
}

/**
 * 校验 ADMIN_PASSWORD 是否发生过轮换：库里保存“v1:盐:scrypt(盐,密码)”，
 * 指纹变化说明密码已改，撤销全部既有会话，旧 Cookie 无法继续登录后台。
 * “更新指纹 + 递增 generation + 清空 sessions”在同一事务内完成：
 * 中途崩溃不会留下“指纹已新、会话未撤”的永久窗口。
 * 首次运行只记录指纹；旧格式（非 v1:）指纹无法验证当前密码是否未变，
 * 迁移为 scrypt 时按最保守路径先撤销一次；环境变量缺失时不改动。
 */
export function enforceAdminPasswordFingerprint(): { recorded: boolean; revoked: boolean } {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return { recorded: false, revoked: false };
  return db.transaction(() => {
    const row = db.prepare("SELECT password_fingerprint FROM auth_state WHERE singleton = 1").get() as { password_fingerprint: string | null } | undefined;
    if (!row) return { recorded: false, revoked: false };
    const stored = row.password_fingerprint;
    if (stored && !FINGERPRINT_PATTERN.test(stored)) {
      // 旧格式指纹（上一版为 salt.sha256）：无法证明旧指纹对应的就是当前密码，
      // 升级迁移时一律撤销一次；代价只是管理员重新登录一次。
      db.prepare("UPDATE auth_state SET password_fingerprint = ?, updated_at = ? WHERE singleton = 1")
        .run(fingerprintWith(crypto.randomBytes(16).toString("hex"), password), now());
      revokeAllSessions();
      return { recorded: true, revoked: true };
    }
    if (stored) {
      if (matchesFingerprint(stored, password)) return { recorded: false, revoked: false };
      const [version, salt] = stored.split(":");
      db.prepare("UPDATE auth_state SET password_fingerprint = ?, updated_at = ? WHERE singleton = 1")
        .run(`${version}:${salt}:${crypto.scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex")}`, now());
      revokeAllSessions();
      return { recorded: true, revoked: true };
    }
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("UPDATE auth_state SET password_fingerprint = ?, updated_at = ? WHERE singleton = 1")
      .run(fingerprintWith(salt, password), now());
    return { recorded: true, revoked: false };
  })();
}
