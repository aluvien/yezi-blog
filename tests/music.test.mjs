import test from "node:test";
import assert from "node:assert/strict";
import { createQQMusicSpec, fetchMusicMetadata, normalizeMusicDisplayText, parseMusicSpec, resolveMusicCover } from "../src/lib/music.ts";
import { normalizeQQSearchTracks } from "../src/lib/qq-music-api.ts";
import { isGlobalPlaybackActiveForCard } from "../src/lib/player-store.ts";

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

test("matching inline tracks remain marked as playing after client navigation rebuilds card ids", () => {
  const playingState = {
    playing: true,
    cardId: "article-card-before-navigation",
    trackKey: "qqvip:62079",
    currentTime: 12,
    lrc: null,
    lyricText: null,
    trackName: "测试歌曲",
    trackArtist: "测试歌手",
  };

  assert.equal(isGlobalPlaybackActiveForCard(playingState, "article-card-before-navigation", false), true);
  assert.equal(isGlobalPlaybackActiveForCard(playingState, "article-card-after-navigation", true), true);
  assert.equal(isGlobalPlaybackActiveForCard(playingState, "unrelated-card", false), false);
  assert.equal(isGlobalPlaybackActiveForCard({ ...playingState, playing: false }, "article-card-after-navigation", true), false);
});

test("playlist display metadata keeps cached song details and total while random mode reshuffles on page initialization", async () => {
  const originalFetch = globalThis.fetch;
  const originalRandom = Math.random;
  const requested = [];
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return Response.json({
      total: 12,
      tracks: [
        { name: "第一首", artist: "甲", cover: "https://example.com/1.jpg", key: "qqvip:Song01" },
        { name: "第二首", artist: "乙", cover: "https://example.com/2.jpg", key: "qqvip:Song02" },
        { name: "第三首", artist: "丙", cover: "https://example.com/3.jpg", key: "qqvip:Song03" },
      ],
    });
  };
  Math.random = () => 0;
  try {
    const spec = parseMusicSpec("qqvip:Playlist01:playlist:random");
    assert.ok(spec);
    const tracks = await fetchMusicMetadata(spec);
    assert.equal(requested[0], "/api/music/qq?id=Playlist01&type=playlist-metadata");
    assert.deepEqual(tracks.map(({ name, artist, playlistTotal }) => ({ name, artist, playlistTotal })), [
      { name: "第二首", artist: "乙", playlistTotal: 12 },
      { name: "第三首", artist: "丙", playlistTotal: 12 },
      { name: "第一首", artist: "甲", playlistTotal: 12 },
    ]);
    assert.equal(tracks.every((track) => track.url === "" && track.lrc === ""), true);
  } finally {
    globalThis.fetch = originalFetch;
    Math.random = originalRandom;
  }
});
