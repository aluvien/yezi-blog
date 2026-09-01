import test from "node:test";
import assert from "node:assert/strict";

const { qqMusicHealthNeedsAttention } = await import("../src/lib/qq-music-health.ts");

test("QQ Music health requires attention whenever playback was not verified", () => {
  assert.equal(qqMusicHealthNeedsAttention("healthy"), false);
  assert.equal(qqMusicHealthNeedsAttention("missing_session"), true);
  assert.equal(qqMusicHealthNeedsAttention("expired"), true);
  assert.equal(qqMusicHealthNeedsAttention("unavailable"), true);
  assert.equal(qqMusicHealthNeedsAttention("unverified"), true);
});
