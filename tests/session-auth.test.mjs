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
  deleteExpiredSessions,
  deleteSession,
  getLoginAttempt,
  getSessionByToken,
  recordLoginFailure,
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
