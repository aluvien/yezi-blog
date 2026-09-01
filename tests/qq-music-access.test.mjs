import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-qq-access-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.QQ_MUSIC_SIGNING_KEY = "test-signing-key-that-is-at-least-thirty-two-bytes";

const {
  cleanupUnusedQQMusicCache,
  createMoment,
  createPost,
  db,
  getQQMusicMetadata,
  getQQMusicPlaylistMetadata,
  setSiteSettings,
  updatePost,
  upsertQQMusicMetadata,
  upsertQQMusicPlaylistMetadata,
} = await import("../src/lib/db.ts");
const {
  createLyricAuthorization,
  extractMusicSpecs,
  invalidateQQMusicAccessCache,
  isPublicQQMusicSpec,
  listReferencedQQMusicPlaylistIds,
  listReferencedQQMusicSongIds,
  verifyLyricAuthorization,
} = await import("../src/lib/qq-music-access.ts");

test.after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test("only music referenced by public content or public settings is authorized", () => {
  const published = createPost({ title: "公开音乐", content: "!music qqvip:PublicSong01:song", status: "published" });
  createPost({ title: "草稿音乐", content: "qqvip:DraftSong01:song", status: "draft" });
  createMoment({ content: "!music qqvip:MomentList01:playlist" });
  setSiteSettings({ default_music: "qqvip:DefaultList01:playlist", about_content: "qqvip:AboutSong01:song" });
  invalidateQQMusicAccessCache();

  assert.equal(isPublicQQMusicSpec("song", "PublicSong01"), true);
  assert.equal(isPublicQQMusicSpec("song", "DraftSong01"), false);
  assert.equal(isPublicQQMusicSpec("playlist", "MomentList01"), true);
  assert.equal(isPublicQQMusicSpec("playlist", "DefaultList01"), true);
  assert.equal(isPublicQQMusicSpec("song", "AboutSong01"), true);

  updatePost(published.id, { title: published.title, content: "音乐已撤回", status: "draft" });
  invalidateQQMusicAccessCache();
  assert.equal(isPublicQQMusicSpec("song", "PublicSong01"), false);
});

test("lyric authorization is scoped, tamper-resistant, and expires", () => {
  const now = Date.now();
  const token = createLyricAuthorization("PublicSong01", now);
  assert.equal(verifyLyricAuthorization("PublicSong01", token, now + 1_000), true);
  assert.equal(verifyLyricAuthorization("OtherSong01", token, now + 1_000), false);
  assert.equal(verifyLyricAuthorization("PublicSong01", `${token}x`, now + 1_000), false);
  assert.equal(verifyLyricAuthorization("PublicSong01", token, now + 11 * 60_000), false);
});

test("music spec extraction accepts shortcodes and fenced values without arbitrary text", () => {
  assert.deepEqual(
    extractMusicSpecs("文字 qqvip:SongValue01:song\n```music\nqqvip:ListValue01:playlist:shuffle\n```").map(({ id, type }) => ({ id, type })),
    [{ id: "SongValue01", type: "song" }, { id: "ListValue01", type: "playlist" }],
  );
});

test("QQ music song and playlist metadata persists independently from playback URLs and cleans unused snapshots", () => {
  upsertQQMusicMetadata([{
    mid: "AboutSong01",
    name: "缓存歌曲",
    artist: "缓存歌手",
    cover: "https://example.com/cover.jpg",
  }, {
    mid: "UnusedSong01",
    name: "未引用歌曲",
    artist: "缓存歌手",
    cover: "https://example.com/unused.jpg",
  }]);
  const metadata = getQQMusicMetadata("AboutSong01");
  assert.ok(metadata);
  assert.deepEqual(
    { mid: metadata.mid, name: metadata.name, artist: metadata.artist, cover: metadata.cover },
    { mid: "AboutSong01", name: "缓存歌曲", artist: "缓存歌手", cover: "https://example.com/cover.jpg" },
  );
  assert.match(metadata.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(getQQMusicMetadata("invalid id"), null);
  upsertQQMusicPlaylistMetadata("MomentList01", 8, [{
    mid: "PlaylistSong01",
    name: "歌单歌曲一",
    artist: "歌单歌手一",
    cover: "https://example.com/playlist-1.jpg",
  }, {
    mid: "PlaylistSong02",
    name: "歌单歌曲二",
    artist: "歌单歌手二",
    cover: "https://example.com/playlist-2.jpg",
  }]);
  upsertQQMusicPlaylistMetadata("UnusedList01", 1, [{
    mid: "UnusedListSong01",
    name: "未引用歌单歌曲",
    artist: "歌单歌手",
    cover: "https://example.com/playlist-unused.jpg",
  }]);
  const playlist = getQQMusicPlaylistMetadata("MomentList01");
  assert.ok(playlist);
  assert.equal(playlist.total, 8);
  assert.deepEqual(playlist.tracks.map(({ mid, name, artist }) => ({ mid, name, artist })), [{
    mid: "PlaylistSong01",
    name: "歌单歌曲一",
    artist: "歌单歌手一",
  }, {
    mid: "PlaylistSong02",
    name: "歌单歌曲二",
    artist: "歌单歌手二",
  }]);
  assert.equal(listReferencedQQMusicSongIds().has("AboutSong01"), true);
  assert.equal(listReferencedQQMusicSongIds().has("DraftSong01"), true);
  assert.equal(listReferencedQQMusicPlaylistIds().has("MomentList01"), true);
  assert.equal(listReferencedQQMusicPlaylistIds().has("DefaultList01"), true);
  assert.deepEqual(
    cleanupUnusedQQMusicCache(listReferencedQQMusicSongIds(), listReferencedQQMusicPlaylistIds()),
    { songs: 2, playlists: 1 },
  );
  assert.equal(getQQMusicMetadata("UnusedSong01"), null);
  assert.equal(getQQMusicMetadata("UnusedListSong01"), null);
  assert.ok(getQQMusicMetadata("PlaylistSong01"));
  assert.ok(getQQMusicPlaylistMetadata("MomentList01"));
  assert.equal(getQQMusicPlaylistMetadata("UnusedList01"), null);
});
