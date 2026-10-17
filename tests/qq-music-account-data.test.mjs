import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-qq-account-data-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.QQ_MUSIC_SESSION_PATH = path.join(root, "data", "qq-session.json");
process.env.ADMIN_API_TOKEN = "account-data-admin-token-at-least-thirty-two-characters";

const require = createRequire(import.meta.url);
const nativeRoot = path.dirname(require.resolve("@yakult-green-tea/qq-music-api/package.json"));
const { createAndroidDevice } = require(path.join(nativeRoot, "dist/src/services/auth/androidDevice.js"));
const { saveQQMusicSession, getQQMusicSession } = await import("../src/lib/qq-music-session.ts");
const { searchQQTracks, searchQQPlaylists, qqMusicRequest } = await import("../src/lib/qq-music-api.ts");
const { GET } = await import("../src/app/api/admin/qq-music/route.ts");
const { db } = await import("../src/lib/db.ts");
const originalFetch = globalThis.fetch;
const nativeAuth = {
  token: "a".repeat(64), device: createAndroidDevice(), expiresAt: Date.now() + 86400000,
  credential: { musicid: "12345678", str_musicid: "12345678", musickey: "private-key", loginType: 2, encryptUin: "encrypted-owner" },
};
const song = { mid: "000sdDGD2Avl8n", name: "鲜花", singer: [{ name: "回春丹" }], album: { mid: "001AlbumMid", name: "鲜花" } };
const rpc = (data, code = 0) => Response.json({ code: 0, req_0: { code, data } });
const playlistRequest = () => GET(new Request("https://yezi.test/api/admin/qq-music?op=playlists", {
  headers: { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` },
}));
const seed = (auth = nativeAuth) => saveQQMusicSession({ cookie: "qm_keyst=private-key; tmeLoginType=2", uin: "12345678", nativeAuth: auth });

test.beforeEach(() => seed());
test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test("personal playlists use the saved native credential instead of removed sidecar routes", async () => {
  const methods = [];
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://u.y.qq.com/cgi-bin/musicu.fcg");
    assert.equal(new Headers(init.headers).get("cookie"), "qm_keyst=private-key; tmeLoginType=2");
    assert.equal(init.cache, "no-store");
    const { comm, req_0: request } = JSON.parse(init.body);
    assert.equal(comm.authst, "private-key");
    methods.push(request.method);
    if (request.method === "GetPlaylistByUin") {
      assert.deepEqual(request.param, { uin: "12345678" });
      return rpc({ v_playlist: [{ tid: "101", dirName: "自建歌单", songNum: 12, picUrl: "https://y.gtimg.cn/created.jpg" }] });
    }
    assert.equal(request.module, "music.musicasset.PlaylistFavRead");
    assert.deepEqual(request.param, { uin: "encrypted-owner", offset: 0, size: 100 });
    return rpc({ v_list: [{ tid: "202", name: "收藏歌单", songnum: 3, logo: "https://y.gtimg.cn/favorite.jpg" }] });
  };
  const response = await playlistRequest();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.counts, { created: 1, collected: 1 });
  assert.deepEqual(body.playlists.map(({ id, name, kind, count }) => ({ id, name, kind, count })), [
    { id: "101", name: "自建歌单", kind: "created", count: 12 },
    { id: "202", name: "收藏歌单", kind: "collected", count: 3 },
  ]);
  assert.deepEqual(methods.sort(), ["CgiGetPlaylistFavInfo", "GetPlaylistByUin"]);
  assert.doesNotMatch(JSON.stringify(body), /private-key|encrypted-owner|authst/);
});

test("a failed collection read keeps created playlists and reports a warning", async () => {
  globalThis.fetch = async (_url, init) => JSON.parse(init.body).req_0.method === "GetPlaylistByUin"
    ? rpc({ v_playlist: [{ tid: "101", dirName: "自建歌单" }] }) : rpc({ v_list: [] }, 2001);
  const response = await playlistRequest();
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.counts, { created: 1, collected: 0 });
  assert.match(body.warning, /收藏歌单读取失败/);
  assert.equal(getQQMusicSession().nativeAuth.credential.musickey, "private-key");
});

test("missing collections identity does not silently become an empty success", async () => {
  seed({ ...nativeAuth, credential: { ...nativeAuth.credential, encryptUin: undefined } });
  globalThis.fetch = async () => rpc({ v_playlist: [] });
  const body = await (await playlistRequest()).json();
  assert.match(body.warning, /缺少收藏歌单标识/);
});

test("business errors and malformed lists are surfaced instead of showing no playlists", async () => {
  for (const result of [rpc({ v_playlist: [], v_list: [] }, 2001), rpc({ unexpected: [] }), rpc({ v_playlist: [null], v_list: [null] })]) {
    globalThis.fetch = async () => result.clone();
    const response = await playlistRequest();
    assert.equal(response.status, 502);
  }
});

test("native search reads Lite songs and playlists and keeps credentials on the server", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://u.y.qq.com/cgi-bin/musicu.fcg");
    const { req_0: request } = JSON.parse(init.body);
    assert.equal(request.method, "DoSearchForQQMusicLite");
    assert.equal(request.param.query, "鲜花");
    assert.equal(request.param.num_per_page, 20);
    assert.match(request.param.search_id, /^\d+$/);
    assert.equal(new Headers(init.headers).get("x-custom-cookie"), null);
    return rpc({ code: 0, body: request.param.search_type === 0
      ? { item_song: [song] } : { item_songlist: [{ dissid: "202", dissname: "鲜花歌单", songnum: 5 }] } });
  };
  const songs = await searchQQTracks("鲜花");
  assert.equal(songs[0].mid, song.mid);
  assert.equal(songs[0].artist, "回春丹");
  assert.equal(songs[0].cover, "https://y.gtimg.cn/music/photo_new/T002R300x300M000001AlbumMid.jpg");
  const playlists = await searchQQPlaylists("鲜花");
  assert.equal(playlists[0].id, "202");
  assert.equal(playlists[0].kind, "search");
  assert.doesNotMatch(JSON.stringify({ songs, playlists }), /private-key|encrypted-owner/);
});

test("a valid empty native search ends normally without using legacy routes", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return rpc({ code: 0, body: { item_song: [] } }); };
  assert.deepEqual(await searchQQTracks("不存在的歌曲"), []);
  assert.equal(calls, 1);
});

test("a rejected native search falls back without clearing a valid stored login", async () => {
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls += 1;
    const request = JSON.parse(init.body).req_0;
    if (request.method === "DoSearchForQQMusicLite") return rpc({}, 2001);
    assert.equal(new Headers(init.headers).get("cookie"), null);
    return rpc({ code: 0, body: { song: { list: [song] } } });
  };
  assert.equal((await searchQQTracks("鲜花"))[0].mid, song.mid);
  assert.equal(calls, 2);
  assert.equal(getQQMusicSession().nativeAuth.credential.musickey, "private-key");
});

test("a plain text 404 reports the HTTP status instead of claiming JSON is invalid", async () => {
  globalThis.fetch = async () => new Response("Not Found", { status: 404 });
  await assert.rejects(qqMusicRequest("/user/getUserPlaylists"), { message: "QQ 音乐服务错误（404）" });
});
