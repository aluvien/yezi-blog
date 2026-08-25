import { db } from "./core";
import type { Moment, Post } from "./types";

export type PublicFeedEntity =
  | { type: "post"; created_at: string; value: Post }
  | { type: "moment"; created_at: string; value: Moment };

type FeedReference = { type: "post" | "moment"; id: number; created_at: string };

export function countPublicFeedItems(): number {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM posts WHERE status = 'published')
      + (SELECT COUNT(*) FROM moments) AS count
  `).get() as { count: number };
  return Number(row.count) || 0;
}

/** SQL pages only lightweight references, then hydrates exactly those IDs in two bulk queries. */
export function listPublicFeedPage(limit: number, offset: number): PublicFeedEntity[] {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const safeOffset = Math.max(0, Math.trunc(offset));
  const references = db.prepare(`
    SELECT type, id, created_at
    FROM (
      SELECT 'post' AS type, id, created_at, 0 AS type_order
      FROM posts WHERE status = 'published'
      UNION ALL
      SELECT 'moment' AS type, id, created_at, 1 AS type_order
      FROM moments
    )
    ORDER BY created_at DESC, type_order ASC, id DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset) as FeedReference[];
  if (references.length === 0) return [];

  const postIds = references.flatMap((item) => item.type === "post" ? [item.id] : []);
  const momentIds = references.flatMap((item) => item.type === "moment" ? [item.id] : []);
  const posts = postIds.length > 0
    ? db.prepare(`SELECT * FROM posts WHERE status = 'published' AND id IN (${postIds.map(() => "?").join(",")})`).all(...postIds) as Post[]
    : [];
  const moments = momentIds.length > 0
    ? db.prepare(`SELECT * FROM moments WHERE id IN (${momentIds.map(() => "?").join(",")})`).all(...momentIds) as Moment[]
    : [];
  const postMap = new Map(posts.map((item) => [item.id, item]));
  const momentMap = new Map(moments.map((item) => [item.id, item]));

  return references.flatMap((reference): PublicFeedEntity[] => {
    if (reference.type === "post") {
      const value = postMap.get(reference.id);
      return value ? [{ type: "post", created_at: reference.created_at, value }] : [];
    }
    const value = momentMap.get(reference.id);
    return value ? [{ type: "moment", created_at: reference.created_at, value }] : [];
  });
}
