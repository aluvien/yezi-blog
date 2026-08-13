import test from "node:test";
import assert from "node:assert/strict";
import { buildVideoEmbedUrl, parseVideoSpec } from "../src/lib/video.ts";

test("parses supported Bilibili and YouTube inputs", () => {
  assert.deepEqual(parseVideoSpec("bilibili:BV1xx411c7mD"), { platform: "bilibili", id: "BV1xx411c7mD" });
  assert.deepEqual(parseVideoSpec("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), { platform: "youtube", id: "dQw4w9WgXcQ" });
  assert.deepEqual(parseVideoSpec("https://www.bilibili.com/video/BV1xx411c7mD?p=2"), { platform: "bilibili", id: "BV1xx411c7mD", page: 2 });
});

test("rejects arbitrary iframe schemes and builds fixed provider URLs", () => {
  assert.equal(parseVideoSpec("javascript:alert(1)"), null);
  const youtube = buildVideoEmbedUrl({ platform: "youtube", id: "dQw4w9WgXcQ" });
  assert.equal(new URL(youtube).hostname, "www.youtube-nocookie.com");
  const bilibili = buildVideoEmbedUrl({ platform: "bilibili", id: "BV1xx411c7mD" });
  assert.equal(new URL(bilibili).hostname, "player.bilibili.com");
});
