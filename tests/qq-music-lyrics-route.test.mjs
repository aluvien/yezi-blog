import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-qq-lyrics-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.QQ_MUSIC_AUDIO_CACHE_ENABLED = "0";
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
const { RequestCookies } = await import("next/dist/compiled/@edge-runtime/cookies/index.js");
const { GET } = await import("../src/app/api/music/qq/route.ts");
const { db, setSiteSettings, upsertQQMusicLyricCache, getQQMusicLyricCache, upsertQQMusicMetadata, upsertQQMusicPlaylistMetadata } = await import("../src/lib/db.ts");
const { createLyricAuthorization, invalidateQQMusicAccessCache } = await import("../src/lib/qq-music-access.ts");
const originalFetch = globalThis.fetch;

function requestMusic(query) {
  return workAsyncStorage.run({ route: "/api/music/qq", isStaticGeneration: false }, () =>
    workUnitAsyncStorage.run({ type: "request", phase: "render", cookies: new RequestCookies(new Headers()) }, () =>
      GET(new Request(`https://yezi.test/api/music/qq?${new URLSearchParams(query)}`))));
}

async function waitUntil(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("background lyric warming did not finish");
}

test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("public playlist lyrics survive expired tokens and bypass upstream resolution limits", async () => {
  const mid = "CachedLyric01";
  setSiteSettings({ default_music: "qqvip:LyricList01:playlist" });
  upsertQQMusicPlaylistMetadata("LyricList01", 1, [{ mid, name: "测试", artist: "", cover: "" }]);
  upsertQQMusicLyricCache(mid, "[00:01.00]已有歌词");
  invalidateQQMusicAccessCache();
  globalThis.fetch = async () => { assert.fail("cached lyrics must not call upstream"); };
  const token = createLyricAuthorization(mid, Date.now() - 11 * 60_000);
  for (let index = 0; index < 15; index += 1) {
    const response = await requestMusic({ type: "lyric", mid, token });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "[00:01.00]已有歌词");
  }
  fs.writeFileSync(path.join(root, "data", "qq-music-alert-state.json"), JSON.stringify({ lastStatus: "expired" }));
  try {
    const response = await requestMusic({ type: "lyric", mid, token });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "[00:01.00]已有歌词");
  } finally {
    fs.unlinkSync(path.join(root, "data", "qq-music-alert-state.json"));
  }
});

test("private cached lyrics still reject expired or missing authorization", async () => {
  const mid = "PrivateLyric01";
  upsertQQMusicLyricCache(mid, "[00:01.00]私有歌词");
  const token = createLyricAuthorization(mid, Date.now() - 11 * 60_000);
  assert.equal((await requestMusic({ type: "lyric", mid, token })).status, 403);
  assert.equal((await requestMusic({ type: "lyric", mid })).status, 403);
});

test("playback warms lyrics for every queued song with four concurrent upstream requests", async () => {
  const mids = Array.from({ length: 6 }, (_, index) => `WarmLyric0${index}`);
  setSiteSettings({ about_content: mids.map((mid) => `qqvip:${mid}:song`).join("\n") });
  upsertQQMusicMetadata(mids.map((mid) => ({ mid, name: "测试", artist: "", cover: "" })));
  invalidateQQMusicAccessCache();
  const gate = Promise.withResolvers();
  const started = [];
  let active = 0;
  let maximumActive = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(input);
    const mid = url.searchParams.get("songmid");
    if (url.pathname === "/getMusicPlay") return Response.json({ data: { url: `https://dl.stream.qqmusic.qq.com/${mid}.mp3` } });
    assert.equal(url.pathname, "/getLyric");
    started.push(mid);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await gate.promise;
    active -= 1;
    return Response.json({ data: { lyric: `[00:01.00]${mid}` } });
  };
  try {
    for (const mid of mids) assert.equal((await requestMusic({ type: "track", mid })).status, 200);
    assert.equal(started.length, 4);
  } finally {
    gate.resolve();
    await waitUntil(() => mids.every((mid) => Boolean(getQQMusicLyricCache(mid))));
  }
  assert.equal(maximumActive, 4);
  assert.deepEqual(started, mids);
});
