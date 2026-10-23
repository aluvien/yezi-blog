import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-playlist-pages-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data/blog.db");
const { db, createMoment, upsertQQMusicPlaylistMetadata } = await import("../src/lib/db.ts");
const { invalidateQQMusicAccessCache } = await import("../src/lib/qq-music-access.ts");
const { GET } = await import("../src/app/api/music/qq/route.ts");
const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
const { RequestCookies } = await import("next/dist/compiled/@edge-runtime/cookies/index.js");
const request = (url) => workAsyncStorage.run({ route: "/api/music/qq", isStaticGeneration: false }, () =>
  workUnitAsyncStorage.run({ type: "request", phase: "render", cookies: new RequestCookies(new Headers()) }, () => GET(new Request(url))));
createMoment({ content: "!music qqvip:PublicPageList:playlist" });
invalidateQQMusicAccessCache();
upsertQQMusicPlaylistMetadata("PublicPageList", 217, Array.from({ length: 217 }, (_, i) => ({ mid: `SongPage${i}`, name: `Song ${i}`, artist: "Artist", cover: "" })));
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });
const get = (query = "") => request(`http://localhost:3030/api/music/qq?type=playlist-metadata&id=PublicPageList${query}`);

test("metadata pagination returns all 217 songs without resolving playback URLs", async () => {
  let offset = 0; const keys = [];
  do {
    const response = await get(`&offset=${offset}&limit=50`);
    assert.equal(response.status, 200);
    const page = await response.json();
    assert.equal(page.total, 217); assert.equal(page.availableTotal, 217);
    keys.push(...page.tracks.map(track => track.key));
    assert.ok(page.tracks.every(track => !("url" in track)));
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(keys.length, 217); assert.equal(new Set(keys).size, 217);
  assert.equal(keys.at(-1), "qqvip:SongPage216");
});
test("unpaged website callers retain their 20-track response", async () => {
  const page = await (await get()).json();
  assert.equal(page.tracks.length, 20); assert.equal(page.total, 217);
  assert.equal(page.nextOffset, undefined);
});
test("invalid pagination is rejected, and out-of-range pages terminate", async () => {
  for (const query of ["&offset=-1&limit=50", "&offset=0&limit=101", "&offset=0", "&limit=50", "&offset=abc&limit=20", "&offset=0&limit=0"]) {
    assert.equal((await get(query)).status, 400);
  }
  const page = await (await get("&offset=500&limit=50")).json();
  assert.deepEqual(page.tracks, []); assert.equal(page.nextOffset, null);
});
test("metadata pagination still enforces public playlist authorization", async () => {
  const response = await request("http://localhost:3030/api/music/qq?type=playlist-metadata&id=PrivateList&offset=0&limit=50");
  assert.equal(response.status, 403);
});
