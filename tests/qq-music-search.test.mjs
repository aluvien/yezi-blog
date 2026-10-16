import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-qq-search-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.QQ_MUSIC_SESSION_PATH = path.join(root, "data", "qq-session.json");
process.env.ADMIN_API_TOKEN = "search-admin-token-with-at-least-thirty-two-characters";

const { searchQQTracks } = await import("../src/lib/qq-music-api.ts");
const { saveQQMusicSession } = await import("../src/lib/qq-music-session.ts");
const { GET } = await import("../src/app/api/admin/qq-music/route.ts");
const { db, getQQMusicMetadata } = await import("../src/lib/db.ts");
const originalFetch = globalThis.fetch;
const song = { mid: "000sdDGD2Avl8n", name: "鲜花", singer: [{ name: "回春丹" }], album: { mid: "001AlbumMid", name: "鲜花" } };
const desktop = (list) => ({ code: 0, req_0: { code: 0, data: { code: 0, body: { song: { list } } } } });
const legacy = { response: { code: 0, data: { song: { list: [song] } } } };

test.afterEach(() => { globalThis.fetch = originalFetch; });
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test("admin search uses the working desktop client and caches complete card metadata", async () => {
  // An existing login must not be exposed to a public metadata request.
  saveQQMusicSession({ cookie: "qqmusic_key=private-playback-key", uin: "12345678" });
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls += 1;
    assert.equal(String(url), "https://u.y.qq.com/cgi-bin/musicu.fcg");
    assert.equal(init.method, "POST");
    assert.equal(init.cache, "no-store");
    assert.ok(init.signal instanceof AbortSignal);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("x-custom-cookie"), null);
    const body = JSON.parse(init.body);
    assert.deepEqual(body.comm, { ct: 19, cv: 2201 });
    assert.equal(body.req_0.module, "music.search.SearchCgiService");
    assert.equal(body.req_0.method, "DoSearchForQQMusicDesktop");
    assert.match(body.req_0.param.searchid, /^\d{1,20}$/);
    assert.equal(headers.get("user-agent"), "Mozilla/5.0");
    const { searchid, ...param } = body.req_0.param;
    assert.ok(searchid);
    assert.deepEqual(param, { query: "鲜花", num_per_page: 30, page_num: 1, search_type: 0, grp: true, highlight: false });
    return Response.json(desktop([song]));
  };
  const response = await GET(new Request("https://yezi.test/api/admin/qq-music?op=search&q=%E9%B2%9C%E8%8A%B1", {
    headers: { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}` },
  }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const { tracks } = await response.json();
  assert.equal(tracks[0].mid, song.mid);
  assert.equal(tracks[0].name, "鲜花");
  assert.equal(tracks[0].artist, "回春丹");
  assert.equal(tracks[0].album, "鲜花");
  assert.equal(tracks[0].cover, "https://y.gtimg.cn/music/photo_new/T002R300x300M000001AlbumMid.jpg");
  assert.equal(getQQMusicMetadata(song.mid).cover, tracks[0].cover);
  assert.equal(calls, 1);
});

test("a valid empty result remains empty without trying a broken legacy service", async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return Response.json(desktop([])); };
  assert.deepEqual(await searchQQTracks("不存在的歌曲"), []);
  assert.equal(calls, 1);
});

test("failed or malformed desktop responses fall back to the existing sidecar", async () => {
  const failures = [
    () => new Response("upstream failed", { status: 500 }),
    () => new Response("invalid json"),
    () => Response.json({ ...desktop([song]), code: 1000 }),
    () => Response.json({ code: 0, req_0: { code: 2001, data: desktop([song]).req_0.data } }),
    () => Response.json({ code: 0, req_0: { code: 0, data: { code: 500, body: { song: { list: [song] } } } } }),
    () => Response.json({ code: 0, req_0: { code: 0, data: {} } }),
    () => { throw new DOMException("Timed out", "TimeoutError"); },
  ];
  for (const failure of failures) {
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls += 1;
      if (calls === 1) return failure();
      assert.equal(new URL(url).pathname, "/getSearchByKey");
      assert.equal(new URL(url).searchParams.get("key"), "鲜花");
      assert.equal(new URL(url).searchParams.get("limit"), "3");
      assert.equal(new Headers(init.headers).get("x-custom-cookie"), null);
      return Response.json(legacy);
    };
    const tracks = await searchQQTracks("鲜花", 3);
    assert.equal(tracks[0].mid, song.mid);
    assert.equal(calls, 2);
  }
});

test("an unavailable search reports an error instead of pretending there are no matches", async () => {
  for (const fallback of [{ code: 500, data: { song: { list: [] } } }, { error: "private-upstream-detail" }]) {
    let calls = 0;
    globalThis.fetch = async () => ++calls === 1
      ? new Response("failed", { status: 500 }) : Response.json(fallback);
    await assert.rejects(searchQQTracks("鲜花"), { message: "QQ 音乐歌曲搜索暂不可用，请稍后重试" });
  }
});

test("blank keywords do not make requests, and caller input stays bounded", async () => {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.req_0.param.query.length, 80);
    assert.equal(body.req_0.param.num_per_page, 1);
    return Response.json(desktop([song, song]));
  };
  assert.deepEqual(await searchQQTracks("  "), []);
  assert.equal((await searchQQTracks("  " + "字".repeat(100) + "  ", 0)).length, 1);
});
