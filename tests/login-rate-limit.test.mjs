import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-login-limit-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.ADMIN_PASSWORD = "isolated-login-test";
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
const { ResponseCookies } = await import("next/dist/compiled/@edge-runtime/cookies/index.js");
const { login } = await import("../src/lib/auth.ts");
const { db, getLoginAttempt } = await import("../src/lib/db.ts");
const originalCompare = crypto.timingSafeEqual;
const originalNow = Date.now;
let comparisons = 0;
crypto.timingSafeEqual = (...args) => { comparisons++; return originalCompare(...args); };
function attempt(password, ip = "unknown") {
  const cookies = new ResponseCookies(new Headers());
  return workAsyncStorage.run({ route: "/api/admin/login", isStaticGeneration: false }, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "action", userspaceMutableCookies: cookies, mutableCookies: cookies, cookies }, () => login(password, { ip })));
}
test.beforeEach(() => { db.exec("DELETE FROM login_attempts; DELETE FROM sessions;"); comparisons = 0; });
test.afterEach(() => { Date.now = originalNow; });
test.after(() => { crypto.timingSafeEqual = originalCompare; db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test("account lock rejects fresh-client guesses before password verification and expires normally", async () => {
  for (let i = 0; i < 25; i++) await attempt("wrong", `client-${i}`);
  const until = getLoginAttempt("__admin_account__").blocked_until;
  assert.ok(until > Date.now());
  const before = comparisons;
  for (let i = 0; i < 100; i++) assert.equal((await attempt("wrong", "new-client")).blocked, true);
  const correct = await attempt(process.env.ADMIN_PASSWORD, "new-client");
  assert.equal(correct.blocked, true);
  assert.ok(correct.retryAfter > 0 && correct.retryAfter <= 900);
  assert.equal(comparisons, before);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
  assert.equal(getLoginAttempt("__admin_account__").blocked_until, until, "rejected attempts do not extend the lock");
  Date.now = () => until + 1;
  assert.deepEqual(await attempt(process.env.ADMIN_PASSWORD, "new-client"), { ok: true });
  assert.equal(getLoginAttempt("__admin_account__"), undefined);
});

test("one blocked client does not prevent a different client from logging in", async () => {
  for (let i = 0; i < 5; i++) await attempt("wrong", "client-a");
  const before = comparisons;
  assert.equal((await attempt(process.env.ADMIN_PASSWORD, "client-a")).blocked, true);
  assert.equal(comparisons, before);
  assert.deepEqual(await attempt(process.env.ADMIN_PASSWORD, "client-b"), { ok: true });
});

test("direct clients with unknown address are still bounded by the account limit", async () => {
  for (let i = 0; i < 25; i++) await attempt("wrong");
  const before = comparisons;
  assert.equal((await attempt(process.env.ADMIN_PASSWORD)).blocked, true);
  assert.equal(comparisons, before);
  assert.equal(getLoginAttempt("unknown"), undefined);
});
