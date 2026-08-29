import test from "node:test";
import assert from "node:assert/strict";
import { createQQMusicSpec, normalizeMusicDisplayText, parseMusicSpec, resolveMusicCover } from "../src/lib/music.ts";
import { normalizeQQSearchTracks } from "../src/lib/qq-music-api.ts";

test("QQ search accepts a top-level albummid and builds its cover URL", () => {
  const tracks = normalizeQQSearchTracks({
    data: {
      song: {
        list: [{
          songmid: "002u1lkd1zb2Ie",
          songname: "一生所爱",
          singer: [{ name: "卢冠廷" }],
          albumname: "大话西游",
          albummid: "001UAAKE4QJguW",
        }],
      },
    },
  });

  assert.deepEqual(tracks, [{
    mid: "002u1lkd1zb2Ie",
    name: "一生所爱",
    artist: "卢冠廷",
    album: "大话西游",
    cover: "https://y.gtimg.cn/music/photo_new/T002R300x300M000001UAAKE4QJguW.jpg",
  }]);
});

test("QQ search music spec remains a compact shortcode", () => {
  const value = createQQMusicSpec("002u1lkd1zb2Ie");

  assert.deepEqual(parseMusicSpec(value), {
    server: "qqvip",
    id: "002u1lkd1zb2Ie",
    type: "song",
    shuffle: false,
  });
  assert.equal(createQQMusicSpec("002u1lkd1zb2Ie"), "qqvip:002u1lkd1zb2Ie:song");
});

test("legacy player labels are constrained to plain text before reaching APlayer", () => {
  assert.equal(normalizeMusicDisplayText('<img onerror="alert(1)">歌名'), 'img onerror="alert(1)" 歌名');
  assert.equal(normalizeMusicDisplayText("<style>body{display:none}</style>"), "style body{display:none} /style");
  assert.equal(normalizeMusicDisplayText("\u0000\n 正常歌名 "), "正常歌名");
});

test("music without a cover uses the configured site image before the built-in placeholder", () => {
  assert.equal(resolveMusicCover("", "/uploads/site-logo.png"), "/uploads/site-logo.png");
  assert.equal(resolveMusicCover(undefined, ""), "/placeholder.svg");
  assert.equal(resolveMusicCover("", "//example.com/site-logo.png"), "https://example.com/site-logo.png");
  assert.equal(resolveMusicCover("//y.gtimg.cn/music/cover.jpg", "/uploads/site-logo.png"), "https://y.gtimg.cn/music/cover.jpg");
});
