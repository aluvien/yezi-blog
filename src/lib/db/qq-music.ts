import { db, now } from "./core";

export type QQMusicMetadata = {
  mid: string;
  name: string;
  artist: string;
  cover: string;
  updated_at: string;
};

export type QQMusicMetadataInput = Pick<QQMusicMetadata, "mid" | "name" | "artist" | "cover">;

export type QQMusicPlaylistMetadata = {
  playlist_id: string;
  total: number;
  tracks: QQMusicMetadata[];
  updated_at: string;
};

export type QQMusicCacheCleanupResult = {
  songs: number;
  playlists: number;
};

const MID_PATTERN = /^[A-Za-z0-9_-]{4,80}$/;

function clean(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function getQQMusicMetadata(mid: string): QQMusicMetadata | null {
  const normalizedMid = mid.trim();
  if (!MID_PATTERN.test(normalizedMid)) return null;
  return db.prepare("SELECT mid, name, artist, cover, updated_at FROM qq_music_metadata WHERE mid = ?").get(normalizedMid) as QQMusicMetadata | undefined ?? null;
}

/** 批量写入搜索或播放时已确认的稳定展示信息；不缓存临时播放 URL 或 Cookie。 */
export function upsertQQMusicMetadata(items: readonly QQMusicMetadataInput[]): void {
  const records = items.flatMap((item) => {
    const mid = clean(item.mid, 80);
    if (!MID_PATTERN.test(mid)) return [];
    return [{
      mid,
      name: clean(item.name, 180),
      artist: clean(item.artist, 180),
      cover: clean(item.cover, 1_500),
    }];
  });
  if (records.length === 0) return;
  const statement = db.prepare(`
    INSERT INTO qq_music_metadata (mid, name, artist, cover, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(mid) DO UPDATE SET
      name = CASE WHEN excluded.name = '' THEN qq_music_metadata.name ELSE excluded.name END,
      artist = CASE WHEN excluded.artist = '' THEN qq_music_metadata.artist ELSE excluded.artist END,
      cover = CASE WHEN excluded.cover = '' THEN qq_music_metadata.cover ELSE excluded.cover END,
      updated_at = excluded.updated_at
  `);
  const write = db.transaction((rows: typeof records) => {
    const timestamp = now();
    for (const row of rows) statement.run(row.mid, row.name, row.artist, row.cover, timestamp);
  });
  write(records);
}

/** 读取持久化歌单快照；返回顺序稳定的展示信息，不包含播放 URL。 */
export function getQQMusicPlaylistMetadata(playlistId: string): QQMusicPlaylistMetadata | null {
  const normalizedId = playlistId.trim();
  if (!MID_PATTERN.test(normalizedId)) return null;
  const playlist = db.prepare(`
    SELECT playlist_id, total, updated_at
    FROM qq_music_playlists
    WHERE playlist_id = ?
  `).get(normalizedId) as Omit<QQMusicPlaylistMetadata, "tracks"> | undefined;
  if (!playlist) return null;
  const tracks = db.prepare(`
    SELECT metadata.mid, metadata.name, metadata.artist, metadata.cover, metadata.updated_at
    FROM qq_music_playlist_tracks AS playlist_track
    JOIN qq_music_metadata AS metadata ON metadata.mid = playlist_track.mid
    WHERE playlist_track.playlist_id = ?
    ORDER BY playlist_track.position ASC
  `).all(normalizedId) as QQMusicMetadata[];
  if (tracks.length === 0) return null;
  return { ...playlist, tracks };
}

/** 原子替换歌单的稳定展示快照；临时播放地址、歌词授权和 Cookie 均不落库。 */
export function upsertQQMusicPlaylistMetadata(
  playlistId: string,
  total: number,
  items: readonly QQMusicMetadataInput[],
): void {
  const normalizedId = playlistId.trim();
  if (!MID_PATTERN.test(normalizedId)) return;
  const records = items.flatMap((item) => {
    const mid = clean(item.mid, 80);
    if (!MID_PATTERN.test(mid)) return [];
    return [{ mid, name: clean(item.name, 180), artist: clean(item.artist, 180), cover: clean(item.cover, 1_500) }];
  });
  if (records.length === 0) return;

  const writeMetadata = db.prepare(`
    INSERT INTO qq_music_metadata (mid, name, artist, cover, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(mid) DO UPDATE SET
      name = CASE WHEN excluded.name = '' THEN qq_music_metadata.name ELSE excluded.name END,
      artist = CASE WHEN excluded.artist = '' THEN qq_music_metadata.artist ELSE excluded.artist END,
      cover = CASE WHEN excluded.cover = '' THEN qq_music_metadata.cover ELSE excluded.cover END,
      updated_at = excluded.updated_at
  `);
  const writePlaylist = db.prepare(`
    INSERT INTO qq_music_playlists (playlist_id, total, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(playlist_id) DO UPDATE SET
      total = excluded.total,
      updated_at = excluded.updated_at
  `);
  const removeTracks = db.prepare("DELETE FROM qq_music_playlist_tracks WHERE playlist_id = ?");
  const writeTrack = db.prepare(`
    INSERT INTO qq_music_playlist_tracks (playlist_id, position, mid)
    VALUES (?, ?, ?)
  `);
  const write = db.transaction(() => {
    const timestamp = now();
    records.forEach((record) => writeMetadata.run(record.mid, record.name, record.artist, record.cover, timestamp));
    writePlaylist.run(normalizedId, Math.max(records.length, Math.trunc(Number.isFinite(total) ? total : 0)), timestamp);
    removeTracks.run(normalizedId);
    records.forEach((record, position) => writeTrack.run(normalizedId, position, record.mid));
  });
  write();
}

/** 删除未再被正文引用的歌单快照和歌曲展示缓存。 */
export function cleanupUnusedQQMusicCache(
  referencedMids: Iterable<string>,
  referencedPlaylistIds: Iterable<string>,
): QQMusicCacheCleanupResult {
  const songs = new Set([...referencedMids].map((mid) => mid.trim()).filter((mid) => MID_PATTERN.test(mid)));
  const playlists = new Set([...referencedPlaylistIds].map((id) => id.trim()).filter((id) => MID_PATTERN.test(id)));
  const cachedPlaylists = db.prepare("SELECT playlist_id FROM qq_music_playlists").all() as Array<{ playlist_id: string }>;
  const stalePlaylists = cachedPlaylists.map((row) => row.playlist_id).filter((id) => !playlists.has(id));
  const removePlaylistTracks = db.prepare("DELETE FROM qq_music_playlist_tracks WHERE playlist_id = ?");
  const removePlaylist = db.prepare("DELETE FROM qq_music_playlists WHERE playlist_id = ?");
  const removeSong = db.prepare("DELETE FROM qq_music_metadata WHERE mid = ?");
  let removedSongs = 0;
  const cleanup = db.transaction(() => {
    for (const id of stalePlaylists) {
      removePlaylistTracks.run(id);
      removePlaylist.run(id);
    }
    const retainedPlaylistSongs = db.prepare("SELECT DISTINCT mid FROM qq_music_playlist_tracks").all() as Array<{ mid: string }>;
    retainedPlaylistSongs.forEach((row) => songs.add(row.mid));
    const cachedSongs = db.prepare("SELECT mid FROM qq_music_metadata").all() as Array<{ mid: string }>;
    for (const row of cachedSongs) {
      if (!songs.has(row.mid)) removedSongs += removeSong.run(row.mid).changes;
    }
  });
  cleanup();
  return { songs: removedSongs, playlists: stalePlaylists.length };
}

/** 删除没有任何公开内容引用的展示缓存；返回实际删除的歌曲数量。 */
export function cleanupUnusedQQMusicMetadata(referencedMids: Iterable<string>): number {
  const referenced = new Set(
    [...referencedMids].map((mid) => mid.trim()).filter((mid) => MID_PATTERN.test(mid)),
  );
  // 兼容旧调用方：歌单快照中的歌曲也属于正在使用的缓存，不能触发外键错误或被误删。
  const playlistSongs = db.prepare("SELECT DISTINCT mid FROM qq_music_playlist_tracks").all() as Array<{ mid: string }>;
  playlistSongs.forEach((row) => referenced.add(row.mid));
  const cached = db.prepare("SELECT mid FROM qq_music_metadata").all() as Array<{ mid: string }>;
  const stale = cached.map((row) => row.mid).filter((mid) => !referenced.has(mid));
  if (stale.length === 0) return 0;
  const remove = db.prepare("DELETE FROM qq_music_metadata WHERE mid = ?");
  const transaction = db.transaction((mids: string[]) => {
    for (const mid of mids) remove.run(mid);
  });
  transaction(stale);
  return stale.length;
}
