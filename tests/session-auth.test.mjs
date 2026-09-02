import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-session-"));
process.env.BLOG_DB_PATH = path.join(tmpDir, "test.db");
process.env.BLOG_ROOT = tmpDir;

const {
  db,
  createSession,
  cleanupExpiredAuthState,
  deleteExpiredSessions,
  deleteSession,
  enforceAdminPasswordFingerprint,
  getLoginAttempt,
  getSessionByToken,
  recordLoginFailure,
  revokeAllSessions,
} = await import("../src/lib/db.ts");

test.after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("session tokens are hashed at rest and can be invalidated", () => {
  const token = "a".repeat(64);
  createSession(token, Date.now() + 60_000);
  const stored = db.prepare("SELECT id FROM sessions").get();
  assert.match(stored.id, /^[0-9a-f]{64}$/);
  assert.notEqual(stored.id, token);
  assert.ok(getSessionByToken(token));
  deleteSession(token);
  assert.equal(getSessionByToken(token), undefined);
});

test("expired sessions are removed before they can authenticate a request", () => {
  const token = "b".repeat(64);
  createSession(token, Date.now() - 1);
  deleteExpiredSessions();
  assert.equal(getSessionByToken(token), undefined);
});

test("session generation revokes every existing device while allowing new sessions", () => {
  const first = "c".repeat(64);
  const second = "d".repeat(64);
  createSession(first, Date.now() + 60_000);
  createSession(second, Date.now() + 60_000);
  const nextGeneration = revokeAllSessions();
  assert.ok(nextGeneration >= 2);
  assert.equal(getSessionByToken(first), undefined);
  assert.equal(getSessionByToken(second), undefined);
  const fresh = "e".repeat(64);
  createSession(fresh, Date.now() + 60_000);
  assert.equal(getSessionByToken(fresh)?.generation, nextGeneration);
});

test("login failure counters block both a client and the account-wide key", () => {
  const now = Date.now();
  const clientKey = "198.51.100.200";
  for (let count = 0; count < 5; count += 1) {
    recordLoginFailure(clientKey, { now, windowMs: 60_000, maxAttempts: 5, blockMs: 60_000 });
  }
  assert.ok((getLoginAttempt(clientKey)?.blocked_until ?? 0) > now);

  for (let count = 0; count < 25; count += 1) {
    recordLoginFailure("__admin_account__", { now, windowMs: 60_000, maxAttempts: 25, blockMs: 60_000 });
  }
  assert.ok((getLoginAttempt("__admin_account__")?.blocked_until ?? 0) > now);
});

test("auth-state cleanup removes old login failures along with expired sessions", () => {
  const now = Date.now();
  const staleKey = "203.0.113.44";
  recordLoginFailure(staleKey, { now: now - 25 * 60 * 60 * 1000, windowMs: 60_000, maxAttempts: 5, blockMs: 60_000 });
  cleanupExpiredAuthState(now);
  assert.equal(getLoginAttempt(staleKey), undefined);
});

test("ADMIN_PASSWORD rotation revokes existing sessions on the next startup check", () => {
  const previous = process.env.ADMIN_PASSWORD;
  const token = "f".repeat(64);
  try {
    process.env.ADMIN_PASSWORD = "rotation-first-password";
    assert.deepEqual(enforceAdminPasswordFingerprint(), { recorded: true, revoked: false });
    createSession(token, Date.now() + 60_000);
    assert.ok(getSessionByToken(token));

    assert.deepEqual(enforceAdminPasswordFingerprint(), { recorded: false, revoked: false });
    assert.ok(getSessionByToken(token), "同一密码重复启动不得撤销会话");

    process.env.ADMIN_PASSWORD = "rotation-second-password";
    assert.deepEqual(enforceAdminPasswordFingerprint(), { recorded: true, revoked: true });
    assert.equal(getSessionByToken(token), undefined, "改密后的旧 Cookie 会话必须失效");

    // verifyPassword 不 trim；指纹必须同样按原始字节比较，
    // 否则 "x" → "x " 会被登录当作改密、被指纹当作没改。
    createSession(token, Date.now() + 60_000);
    process.env.ADMIN_PASSWORD = "rotation-second-password ";
    assert.deepEqual(enforceAdminPasswordFingerprint(), { recorded: true, revoked: true });
    assert.equal(getSessionByToken(token), undefined);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});

test("fingerprint update and session revocation are atomic: a locked DB leaves neither half-applied", async () => {
  const Database = (await import("better-sqlite3")).default;
  const previous = process.env.ADMIN_PASSWORD;
  try {
    process.env.ADMIN_PASSWORD = "atomic-rotation-password";
    // 前一个测试改过密码，这里先让指纹与当前密码对齐（可能顺带撤销旧会话）。
    enforceAdminPasswordFingerprint();
    const token = "d".repeat(64);
    createSession(token, Date.now() + 60_000);

    const locker = new Database(path.join(tmpDir, "test.db"));
    locker.exec("BEGIN EXCLUSIVE");
    const originalTimeout = db.pragma("busy_timeout", { simple: true });
    db.pragma("busy_timeout = 200");
    try {
      process.env.ADMIN_PASSWORD = "atomic-rotated-password";
      assert.throws(() => enforceAdminPasswordFingerprint());
    } finally {
      db.pragma(`busy_timeout = ${Number(originalTimeout) || 5000}`);
      locker.exec("ROLLBACK");
      locker.close();
    }
    // 事务回滚后：指纹仍是旧密码的，会话仍在；下一次成功启动必须完成整套轮换。
    assert.ok(getSessionByToken(token), "失败的轮换不得留下任何一半效果");
    assert.deepEqual(enforceAdminPasswordFingerprint(), { recorded: true, revoked: true });
    assert.equal(getSessionByToken(token), undefined);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = previous;
  }
});
