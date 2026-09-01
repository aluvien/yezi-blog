import test from "node:test";
import assert from "node:assert/strict";
import { createMediaPositionState, createMediaSessionMetadata } from "../src/lib/media-session.ts";

test("iOS media session metadata includes title, artist and an absolute artwork URL", () => {
  assert.deepEqual(createMediaSessionMetadata({
    name: "第三人称",
    artist: "蔡依林",
    cover: "/uploads/cover.jpg",
    url: "https://example.com/audio.m4a",
    lrc: "",
  }, "https://yezi.me/posts/music-test"), {
    title: "第三人称",
    artist: "蔡依林",
    artwork: [{ src: "https://yezi.me/uploads/cover.jpg" }],
  });
});

test("media session position is clamped and rejects an unknown duration", () => {
  assert.deepEqual(createMediaPositionState({ duration: 180, currentTime: 220, playbackRate: 1 }), {
    duration: 180,
    playbackRate: 1,
    position: 180,
  });
  assert.equal(createMediaPositionState({ duration: Number.NaN, currentTime: 10, playbackRate: 1 }), null);
});
