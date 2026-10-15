import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-qq-credential-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
const { getQQMusicSession, saveQQMusicSession } = await import("../src/lib/qq-music-session.ts");
const { inspectQQMusicAccount, maintainQQMusicSession, qqMusicCredentialExpiresAt, qqMusicSessionExpiresAt } = await import("../src/lib/qq-music-credential.ts");
const { inspectQQMusicHealth, qqMusicSessionKnownInvalid } = await import("../src/lib/qq-music-health.ts");
const originalFetch = globalThis.fetch;
const require = createRequire(import.meta.url);
const nativeRoot = path.dirname(require.resolve("@yakult-green-tea/qq-music-api/package.json"));
const { createAndroidDevice } = require(path.join(nativeRoot, "dist/src/services/auth/androidDevice.js"));
const { qqMusicRequest } = await import("../src/lib/qq-music-api.ts");
const cookie = "uin=12345678; qqmusic_uin=12345678; qm_keyst=old-key; qqmusic_key=old-key; tmeLoginType=2";
const sessionPath = path.join(root, "data", "qq-music-session.json");
const response = (data, code = 0) => Response.json({ code: 0, req_0: { code, data } });
const accountResponse = () => response({ info: { nick: "test" } });

function seed(extra = {}) {
  saveQQMusicSession({ cookie, uin: "12345678", ...extra });
  const saved = JSON.parse(fs.readFileSync(sessionPath, "utf8"));
  saved.updatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  fs.writeFileSync(sessionPath, JSON.stringify(saved));
  return getQQMusicSession();
}

test.beforeEach(() => { seed(); });
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => { fs.rmSync(root, { recursive: true, force: true }); });

test("login expiry uses the upstream key creation time and lifetime in seconds", () => {
  const created = Date.parse("2026-10-15T00:00:00Z") / 1000;
  const credential = { musickeyCreateTime: String(created), keyExpiresIn: "86400" };
  assert.equal(qqMusicCredentialExpiresAt(credential), Date.parse("2026-10-16T00:00:00Z"));
  assert.equal(qqMusicSessionExpiresAt(seed({ credential })), "2026-10-16T00:00:00.000Z");
});

test("missing or malformed upstream timing cannot produce an expiry date", () => {
  const created = Date.parse("2026-10-15T00:00:00Z") / 1000;
  for (const invalid of [undefined, null, "", " ", "invalid", true, [], [86400], {}, -1, 0, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER]) {
    assert.equal(qqMusicCredentialExpiresAt({ musickeyCreateTime: created, keyExpiresIn: invalid }), null);
    assert.equal(qqMusicCredentialExpiresAt({ musickeyCreateTime: invalid, keyExpiresIn: 86400 }), null);
  }
  assert.equal(qqMusicSessionExpiresAt(null), null);
  assert.equal(qqMusicSessionExpiresAt(seed()), null);
});

test("local session TTL and save times are never presented as QQ login expiry", () => {
  const nativeAuth = { token: "a".repeat(64), credential: { musicid: "12345678", musickey: "native-key", loginType: 6 }, device: {}, expiresAt: Date.now() + 86400000 };
  const session = seed({
    nativeAuth,
    credential: { musickeyCreateTime: 1792022400, keyExpiresIn: 86400 },
    refreshedAt: new Date().toISOString(),
  });
  assert.equal(qqMusicSessionExpiresAt(session), null);
  const nativeCredential = { ...nativeAuth.credential, musickeyCreateTime: 1792022400, keyExpiresIn: 86400 };
  const saved = seed({ nativeAuth: { ...nativeAuth, credential: nativeCredential } });
  assert.equal(qqMusicSessionExpiresAt(saved), new Date((1792022400 + 86400) * 1000).toISOString());
});

test("renewal replaces timing as a pair and never carries an old key's expiry into a new key", async () => {
  const created = Math.floor(Date.now() / 1000);
  const oldCredential = { musickeyCreateTime: created - 172800, keyExpiresIn: 86400 };
  for (const timing of [{}, { keyExpiresIn: 86400 }, { musickeyCreateTime: created }, { musickeyCreateTime: created, keyExpiresIn: 172800 }]) {
    seed({ credential: oldCredential });
    globalThis.fetch = async (url, options) => JSON.parse(options.body).req_0.method === "Login"
      ? response({ musicid: 12345678, musickey: "new-key", loginType: 2, ...timing }) : accountResponse();
    assert.deepEqual(await maintainQQMusicSession(), { refreshed: true });
    const saved = getQQMusicSession();
    assert.match(saved.cookie, /qm_keyst=new-key/);
    if (timing.musickeyCreateTime && timing.keyExpiresIn) {
      assert.equal(qqMusicSessionExpiresAt(saved), new Date((created + 172800) * 1000).toISOString());
    } else {
      assert.equal(qqMusicSessionExpiresAt(saved), null);
      assert.equal(saved.credential.musickeyCreateTime, undefined);
      assert.equal(saved.credential.keyExpiresIn, undefined);
    }
  }
});

test("renewal of the same key retains known timing only when no new timing fields are returned", async () => {
  const created = Math.floor(Date.now() / 1000);
  const credential = { musickey: "old-key", musickeyCreateTime: created, keyExpiresIn: 172800 };
  for (const timing of [{}, { keyExpiresIn: 86400 }]) {
    seed({ credential });
    globalThis.fetch = async (url, options) => JSON.parse(options.body).req_0.method === "Login"
      ? response({ musicid: 12345678, musickey: "old-key", loginType: 2, ...timing }) : accountResponse();
    assert.deepEqual(await maintainQQMusicSession(), { refreshed: true });
    assert.equal(qqMusicSessionExpiresAt(getQQMusicSession()), "keyExpiresIn" in timing ? null : new Date((created + 172800) * 1000).toISOString());
  }
});

test("complete native credentials survive a fresh process with restricted file permissions", () => {
  const nativeAuth = { token: "a".repeat(64), credential: { musicid: "12345678", musickey: "native-key", loginType: 6, refresh_key: "refresh-secret" }, device: { androidId: "saved-device" }, expiresAt: Date.now() + 86400000 };
  saveQQMusicSession({ cookie, uin: "12345678", nativeAuth });
  assert.equal(fs.statSync(sessionPath).mode & 0o777, 0o600);
  const child = spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./tests/register-alias.mjs", "--input-type=module", "-e", `import { getQQMusicSession } from './src/lib/qq-music-session.ts'; const session=getQQMusicSession(); console.log(JSON.stringify({restored:session.nativeAuth.credential.refresh_key === 'refresh-secret', device:session.nativeAuth.device.androidId === 'saved-device'}));`], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { restored: true, device: true });
});

test("successful renewal validates the new key and persists it atomically", async () => {
  const methods = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), "https://u.y.qq.com/cgi-bin/musicu.fcg");
    const body = JSON.parse(options.body);
    methods.push(body.req_0.method);
    if (body.req_0.method === "Login") {
      assert.equal(body.req_0.param.loginMode, 2);
      assert.equal(body.req_0.param.musicid, 12345678);
      assert.equal(body.req_0.param.musickey, "old-key");
      return response({ musicid: 12345678, musickey: "new-key", loginType: 2 });
    }
    if (methods.length === 3) assert.match(options.headers.Cookie, /qm_keyst=new-key/);
    return accountResponse();
  };
  assert.deepEqual(await maintainQQMusicSession(), { refreshed: true });
  assert.deepEqual(methods, ["GetLoginUserInfo", "Login", "GetLoginUserInfo"]);
  assert.match(getQQMusicSession().cookie, /qm_keyst=new-key/);
  assert.ok(getQQMusicSession().refreshedAt);
});

test("failed renewal preserves the active credential and limits retry frequency", async () => {
  let refreshCalls = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.req_0.method === "Login") refreshCalls += 1;
    return response({}, 1000);
  };
  assert.deepEqual(await maintainQQMusicSession(), { refreshed: false });
  assert.equal(getQQMusicSession().cookie, cookie);
  assert.deepEqual(await maintainQQMusicSession(), { refreshed: false });
  assert.equal(refreshCalls, 1);
});

test("renewal is shared by concurrent callers and cannot overwrite a newer QR login", async () => {
  let release;
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let refreshCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (JSON.parse(options.body).req_0.method === "Login") {
      refreshCalls += 1;
      started();
      await gate;
      return response({ musicid: 12345678, musickey: "stale-refreshed-key", loginType: 2 });
    }
    return accountResponse();
  };
  const first = maintainQQMusicSession();
  const second = maintainQQMusicSession();
  assert.equal(first, second);
  await waiting;
  saveQQMusicSession({ cookie: "uin=12345678; qm_keyst=new-scan-key", uin: "12345678" });
  release();
  assert.deepEqual(await first, { refreshed: false });
  assert.match(getQQMusicSession().cookie, /new-scan-key/);
  assert.equal(refreshCalls, 1);
});

test("a cloud restore cancels an in-flight renewal", async () => {
  globalThis.fetch = async (url, options) => {
    if (JSON.parse(options.body).req_0.method === "Login") {
      const directory = path.join(root, "data", "backups", "cloud");
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(path.join(directory, "restore-epoch"), "new-data");
      return response({ musicid: 12345678, musickey: "late-key", loginType: 2 });
    }
    return accountResponse();
  };
  assert.deepEqual(await maintainQQMusicSession(), { refreshed: false });
  assert.equal(getQQMusicSession().cookie, cookie);
});

test("a refreshed credential rejected by QQ never replaces the previous credential", async () => {
  let checks = 0;
  globalThis.fetch = async (url, options) => {
    if (JSON.parse(options.body).req_0.method === "Login") return response({ musicid: 12345678, musickey: "rejected-key", loginType: 2 });
    checks += 1;
    return checks === 1 ? accountResponse() : response({}, 104401);
  };
  assert.deepEqual(await maintainQQMusicSession(), { refreshed: false });
  assert.equal(getQQMusicSession().cookie, cookie);
});

test("song unavailability and cookie-related playback text do not prove account expiration", async () => {
  globalThis.fetch = async (url) => String(url).startsWith("https://u.y.qq.com/")
    ? accountResponse() : Response.json({ data: { message: "cookie error / 暂无播放链接" } });
  const result = await inspectQQMusicHealth();
  assert.equal(result.status, "playback_unavailable");
  assert.equal(result.authenticated, true);
  assert.equal(result.playable, false);
  assert.doesNotMatch(result.detail, /重新扫码/);
});

test("a free playable song cannot hide a rejected account credential", async () => {
  globalThis.fetch = async () => response({}, 1000);
  const result = await inspectQQMusicHealth();
  assert.equal(result.status, "expired");
  assert.equal(result.authenticated, false);
});

test("rate limits, malformed responses and network failures do not log the account out", async () => {
  for (const mock of [async () => response({}, 104604), async () => Response.json({ code: 0 }), async () => { throw new Error("network down"); }]) {
    globalThis.fetch = mock;
    assert.notEqual((await inspectQQMusicAccount(getQQMusicSession())).status, "expired");
  }
  assert.equal(getQQMusicSession().cookie, cookie);
});

test("old expiration alerts stop blocking playback immediately after a new login", () => {
  const current = getQQMusicSession();
  fs.writeFileSync(path.join(root, "data", "qq-music-alert-state.json"), JSON.stringify({ lastStatus: "expired", sessionVersion: current.revision }));
  assert.equal(qqMusicSessionKnownInvalid(), true);
  saveQQMusicSession({ cookie, uin: "12345678" });
  assert.equal(qqMusicSessionKnownInvalid(), false);
});

test("restored native playback keeps its device identity and bypasses the legacy sidecar", async () => {
  const nativeAuth = {
    token: "a".repeat(64),
    credential: { musicid: "12345678", musickey: "native-key", loginType: 6 },
    device: { ...createAndroidDevice(), qimei: "saved-qimei", qimei36: "saved-qimei36" },
    expiresAt: Date.now() - 1000,
  };
  saveQQMusicSession({ cookie, uin: "12345678", nativeAuth });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls += 1;
    assert.equal(String(url), "https://u.y.qq.com/cgi-bin/musicu.fcg");
    const body = JSON.parse(options.body);
    assert.equal(body.comm.QIMEI, "saved-qimei");
    assert.equal(body.comm.tmeLoginType, 6);
    assert.equal(body.comm.authst, "native-key");
    assert.equal(body.req_0.method, "UrlGetVkey");
    assert.ok(options.signal);
    return response({ sip: ["https://dl.stream.qqmusic.qq.com/"], midurlinfo: [{ songmid: "NativeSong01", purl: "test.m4a?vkey=fake" }] });
  };
  const playback = await qqMusicRequest("/getMusicPlay", { query: { songmid: "NativeSong01", quality: "320" } });
  assert.equal(playback.data.NativeSong01.url, "https://dl.stream.qqmusic.qq.com/test.m4a?vkey=fake");
  assert.equal(calls, 1);
});

test("native renewal uses and retains full refresh credentials and device context", async () => {
  const nativeAuth = {
    token: "b".repeat(64),
    credential: { musicid: "12345678", musickey: "old-native-key", loginType: 6, refresh_key: "saved-refresh-key", refresh_token: "saved-refresh-token" },
    device: { ...createAndroidDevice(), qimei: "persistent-qimei" },
    expiresAt: Date.now() + 86400000,
  };
  seed({ nativeAuth });
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.comm.QIMEI, "persistent-qimei");
    if (body.req_0.method === "Login") {
      assert.equal(body.req_0.param.refresh_key, "saved-refresh-key");
      assert.equal(body.req_0.param.refresh_token, "saved-refresh-token");
      return response({ musicid: "12345678", musickey: "new-native-key", loginType: 6 });
    }
    return accountResponse();
  };
  assert.deepEqual(await maintainQQMusicSession(), { refreshed: true });
  const saved = getQQMusicSession();
  assert.equal(saved.nativeAuth.credential.refresh_key, "saved-refresh-key");
  assert.equal(saved.nativeAuth.credential.musickey, "new-native-key");
  assert.equal(saved.nativeAuth.device.qimei, "persistent-qimei");
});

test("a refresh response for a different account cannot change the active session", async () => {
  seed({ credential: { str_musicid: "12345678" } });
  globalThis.fetch = async (url, options) => JSON.parse(options.body).req_0.method === "Login"
    ? response({ musicid: 87654321, musickey: "other-account-key", loginType: 2 }) : accountResponse();
  assert.deepEqual(await maintainQQMusicSession(), { refreshed: false });
  assert.equal(getQQMusicSession().cookie, cookie);
});
