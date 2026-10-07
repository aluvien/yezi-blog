import test from "node:test";
import assert from "node:assert/strict";

const { getMusicLyrics } = await import("../src/lib/music-lyrics.ts");
const originalFetch = globalThis.fetch;

test.afterEach(() => { globalThis.fetch = originalFetch; });

test("failed lyric requests can retry and successful requests stay shared", async () => {
  const track = { key: "qqvip:RetryLyrics01", url: "", name: "测试", lrc: "/retry-lyrics" };
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return calls === 1 ? new Response("", { status: 403 }) : new Response("[00:01.00]恢复后的歌词");
  };
  assert.deepEqual(await getMusicLyrics(track), []);
  const firstRetry = getMusicLyrics(track);
  assert.equal(getMusicLyrics(track), firstRetry);
  assert.deepEqual(await firstRetry, [{ time: 1, text: "恢复后的歌词" }]);
  assert.deepEqual(await getMusicLyrics(track), [{ time: 1, text: "恢复后的歌词" }]);
  assert.equal(calls, 2);
});

test("network errors and empty upstream lyrics are not cached permanently", async () => {
  const track = { key: "qqvip:EmptyLyrics01", url: "", name: "测试", lrc: "/empty-lyrics" };
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary outage");
    return new Response(calls === 2 ? "" : "[00:02.00]歌词恢复");
  };
  assert.deepEqual(await getMusicLyrics(track), []);
  assert.deepEqual(await getMusicLyrics(track), []);
  assert.deepEqual(await getMusicLyrics(track), [{ time: 2, text: "歌词恢复" }]);
  assert.equal(calls, 3);
});
