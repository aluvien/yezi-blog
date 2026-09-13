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
  /** 实际被删除的歌曲标识；调用方据此一并清理歌词缓存。 */
  removedSongIds: string[];
  /**
   * 被删除的音频副本文件名，在索引行删除前读出。
   * 调用方必须按文件名删除磁盘文件：此时索引行已经不存在，按 mid 反查已无意义。
   */
  removedAudioFiles: string[];
};

export type QQMusicAudioCacheEntry = {
  mid: string;
  file_name: string;
  mime: string;
  bytes: number;
  etag: string;
  created_at: string;
  last_hit_at: string;
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
  const removeAudio = db.prepare("DELETE FROM qq_music_audio_cache WHERE mid = ?");
  const removeLyric = db.prepare("DELETE FROM qq_music_lyric_cache WHERE mid = ?");
  const removedSongIds: string[] = [];
  const removedAudioFiles: string[] = [];
  const cleanup = db.transaction(() => {
    for (const id of stalePlaylists) {
      removePlaylistTracks.run(id);
      removePlaylist.run(id);
    }
    const retainedPlaylistSongs = db.prepare("SELECT DISTINCT mid FROM qq_music_playlist_tracks").all() as Array<{ mid: string }>;
    retainedPlaylistSongs.forEach((row) => songs.add(row.mid));
    // 必须在删除索引行之前把文件名读出来：一旦行没了，调用方就再也无法知道
    // 磁盘上对应哪个文件，那个文件会一直留到下一次周期性孤儿回收。
    const audioFileByMid = new Map<string, string>();
    for (const row of db.prepare("SELECT mid, file_name FROM qq_music_audio_cache").all() as Array<{ mid: string; file_name: string }>) {
      audioFileByMid.set(row.mid, row.file_name);
    }
    const cachedSongs = db.prepare("SELECT mid FROM qq_music_metadata").all() as Array<{ mid: string }>;
    for (const row of cachedSongs) {
      if (songs.has(row.mid)) continue;
      if (removeSong.run(row.mid).changes > 0) removedSongIds.push(row.mid);
    }
    // 音频索引和歌词必须与展示缓存同生命周期，避免留下不一致的缓存状态。
    for (const mid of removedSongIds) {
      const fileName = audioFileByMid.get(mid);
      if (fileName) removedAudioFiles.push(fileName);
      removeAudio.run(mid);
      removeLyric.run(mid);
    }
  });
  cleanup();
  return { songs: removedSongIds.length, playlists: stalePlaylists.length, removedSongIds, removedAudioFiles };
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
  const removeAudio = db.prepare("DELETE FROM qq_music_audio_cache WHERE mid = ?");
  const removeLyric = db.prepare("DELETE FROM qq_music_lyric_cache WHERE mid = ?");
  const transaction = db.transaction((mids: string[]) => {
    for (const mid of mids) {
      remove.run(mid);
      removeAudio.run(mid);
      removeLyric.run(mid);
    }
  });
  transaction(stale);
  return stale.length;
}

/* ------------------------------------------------------------------ *
 * 音频字节缓存索引 + 歌词缓存
 *
 * 只保存“本站磁盘上已经有一份可播放副本”这一事实。播放 URL 是 QQ 的短时效
 * 签名地址，从不写入这些表；文件本体存放于 data/qq-music-audio/。
 * ------------------------------------------------------------------ */

export function getQQMusicAudioCache(mid: string): QQMusicAudioCacheEntry | null {
  const normalizedMid = mid.trim();
  if (!MID_PATTERN.test(normalizedMid)) return null;
  return db.prepare(`
    SELECT mid, file_name, mime, bytes, etag, created_at, last_hit_at
    FROM qq_music_audio_cache WHERE mid = ?
  `).get(normalizedMid) as QQMusicAudioCacheEntry | undefined ?? null;
}

/** 记录一次成功落盘。file_name 必须是规范化后的纯文件名，不接受路径分隔符。 */
export function upsertQQMusicAudioCache(entry: {
  mid: string;
  fileName: string;
  mime: string;
  bytes: number;
  etag: string;
}): void {
  const mid = clean(entry.mid, 80);
  const fileName = clean(entry.fileName, 160);
  if (!MID_PATTERN.test(mid) || !fileName || /[\\/]/.test(fileName)) return;
  const timestamp = now();
  db.prepare(`
    INSERT INTO qq_music_audio_cache (mid, file_name, mime, bytes, etag, created_at, last_hit_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(mid) DO UPDATE SET
      file_name = excluded.file_name,
      mime = excluded.mime,
      bytes = excluded.bytes,
      etag = excluded.etag,
      last_hit_at = excluded.last_hit_at
  `).run(
    mid,
    fileName,
    clean(entry.mime, 100) || "audio/mpeg",
    Number.isFinite(entry.bytes) ? Math.max(0, Math.trunc(entry.bytes)) : 0,
    clean(entry.etag, 64),
    timestamp,
    timestamp,
  );
}

/** 更新 LRU 时间戳；降级播放时调用，让常用歌曲不被容量淘汰优先清掉。 */
export function touchQQMusicAudioCache(mid: string): void {
  const normalizedMid = mid.trim();
  if (!MID_PATTERN.test(normalizedMid)) return;
  db.prepare("UPDATE qq_music_audio_cache SET last_hit_at = ? WHERE mid = ?").run(now(), normalizedMid);
}

export function deleteQQMusicAudioCache(mids: readonly string[]): number {
  const statement = db.prepare("DELETE FROM qq_music_audio_cache WHERE mid = ?");
  const remove = db.transaction((values: string[]) => {
    let removed = 0;
    for (const mid of values) removed += statement.run(mid).changes;
    return removed;
  });
  return remove([...mids]);
}

/** 按 LRU 顺序（最久未命中在前）返回索引，供容量淘汰选择牺牲者。 */
export function listQQMusicAudioCache(): QQMusicAudioCacheEntry[] {
  return db.prepare(`
    SELECT mid, file_name, mime, bytes, etag, created_at, last_hit_at
    FROM qq_music_audio_cache
    ORDER BY last_hit_at ASC, mid ASC
  `).all() as QQMusicAudioCacheEntry[];
}

export function qqMusicAudioCacheTotalBytes(): number {
  const row = db.prepare("SELECT COALESCE(SUM(bytes), 0) AS total FROM qq_music_audio_cache").get() as { total: number } | undefined;
  return row ? Math.max(0, Math.trunc(row.total)) : 0;
}

export function getQQMusicLyricCache(mid: string): string | null {
  const normalizedMid = mid.trim();
  if (!MID_PATTERN.test(normalizedMid)) return null;
  const row = db.prepare("SELECT lyric FROM qq_music_lyric_cache WHERE mid = ?").get(normalizedMid) as { lyric: string } | undefined;
  return row && row.lyric ? row.lyric : null;
}

export function upsertQQMusicLyricCache(mid: string, lyric: string): void {
  const normalizedMid = mid.trim();
  const value = typeof lyric === "string" ? lyric.slice(0, 512 * 1024) : "";
  if (!MID_PATTERN.test(normalizedMid) || !value) return;
  db.prepare(`
    INSERT INTO qq_music_lyric_cache (mid, lyric, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(mid) DO UPDATE SET lyric = excluded.lyric, updated_at = excluded.updated_at
  `).run(normalizedMid, value, now());
}

export function deleteQQMusicLyricCache(mids: readonly string[]): number {
  const statement = db.prepare("DELETE FROM qq_music_lyric_cache WHERE mid = ?");
  const remove = db.transaction((values: string[]) => {
    let removed = 0;
    for (const mid of values) removed += statement.run(mid).changes;
    return removed;
  });
  return remove([...mids]);
}

/** 某首歌所属的所有歌单；用于判断歌单曲目是否属于公开内容。 */
export function qqMusicPlaylistIdsForMid(mid: string): string[] {
  const normalizedMid = mid.trim();
  if (!MID_PATTERN.test(normalizedMid)) return [];
  const rows = db.prepare(
    "SELECT playlist_id FROM qq_music_playlist_tracks WHERE mid = ?",
  ).all(normalizedMid) as Array<{ playlist_id: string }>;
  return rows.map((row) => row.playlist_id);
}
