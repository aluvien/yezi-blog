import test from "node:test";
import assert from "node:assert/strict";
import { createQQMusicSpec, parseMusicSpec } from "../src/lib/music.ts";
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

test("QQ search music spec keeps a safe display snapshot for player fallback", () => {
  const value = createQQMusicSpec("002u1lkd1zb2Ie", {
    title: "一生所爱",
    artist: "卢冠廷",
    cover: "https://y.gtimg.cn/music/photo_new/T002R300x300M000001UAAKE4QJguW.jpg",
  });

  assert.deepEqual(parseMusicSpec(value), {
    server: "qqvip",
    id: "002u1lkd1zb2Ie",
    type: "song",
    shuffle: false,
    title: "一生所爱",
    artist: "卢冠廷",
    cover: "https://y.gtimg.cn/music/photo_new/T002R300x300M000001UAAKE4QJguW.jpg",
  });
  assert.equal(createQQMusicSpec("002u1lkd1zb2Ie"), "qqvip:002u1lkd1zb2Ie:song");
});
