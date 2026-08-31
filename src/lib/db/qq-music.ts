import { db, now } from "./core";

export type QQMusicMetadata = {
  mid: string;
  name: string;
  artist: string;
  cover: string;
  updated_at: string;
};

export type QQMusicMetadataInput = Pick<QQMusicMetadata, "mid" | "name" | "artist" | "cover">;

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
      name = excluded.name,
      artist = excluded.artist,
      cover = excluded.cover,
      updated_at = excluded.updated_at
  `);
  const write = db.transaction((rows: typeof records) => {
    const timestamp = now();
    for (const row of rows) statement.run(row.mid, row.name, row.artist, row.cover, timestamp);
  });
  write(records);
}

/** 删除没有任何公开内容引用的展示缓存；返回实际删除的歌曲数量。 */
export function cleanupUnusedQQMusicMetadata(referencedMids: Iterable<string>): number {
  const referenced = new Set(
    [...referencedMids].map((mid) => mid.trim()).filter((mid) => MID_PATTERN.test(mid)),
  );
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
