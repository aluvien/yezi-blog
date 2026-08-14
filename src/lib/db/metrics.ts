// 阅读/点赞统计 DAO（content_metrics + content_interactions）。
import { db, now } from "./core";
import type { ContentMetrics, ContentTarget, InteractionKind } from "./types";

export function getContentMetrics(targetType: ContentTarget, targetId: number): ContentMetrics {
  const row = db
    .prepare("SELECT views, likes FROM content_metrics WHERE target_type = ? AND target_id = ?")
    .get(targetType, targetId) as ContentMetrics | undefined;
  return { views: row?.views ?? 0, likes: row?.likes ?? 0 };
}

export function getContentMetricsBulk(targetType: ContentTarget, targetIds: number[]): Map<number, ContentMetrics> {
  const ids = [...new Set(targetIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, ContentMetrics>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT target_id, views, likes FROM content_metrics WHERE target_type = ? AND target_id IN (${placeholders})`)
    .all(targetType, ...ids) as Array<{ target_id: number; views: number; likes: number }>;
  for (const row of rows) result.set(row.target_id, { views: row.views, likes: row.likes });
  return result;
}

export function getOverallMetrics(): ContentMetrics {
  const row = db.prepare("SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(likes), 0) AS likes FROM content_metrics").get() as ContentMetrics;
  return { views: Number(row.views) || 0, likes: Number(row.likes) || 0 };
}

export function recordContentInteraction(
  targetType: ContentTarget,
  targetId: number,
  kind: InteractionKind,
  visitorKey: string,
): ContentMetrics {
  const key = visitorKey.trim().slice(0, 128);
  if (!key) return getContentMetrics(targetType, targetId);
  const transaction = db.transaction(() => {
    if (kind === "view") {
      const viewWindowMs = (targetType === "moment" ? 30 : 180) * 24 * 60 * 60 * 1000;
      const existing = db
        .prepare("SELECT created_at FROM content_interactions WHERE target_type = ? AND target_id = ? AND kind = 'view' AND visitor_key = ?")
        .get(targetType, targetId, key) as { created_at: string } | undefined;
      const createdAt = existing ? Date.parse(existing.created_at) : Number.NaN;
      if (existing && Number.isFinite(createdAt) && Date.now() - createdAt < viewWindowMs) return;
      if (existing) {
        db.prepare("DELETE FROM content_interactions WHERE target_type = ? AND target_id = ? AND kind = 'view' AND visitor_key = ?").run(targetType, targetId, key);
      }
    }
    const inserted = db
      .prepare("INSERT OR IGNORE INTO content_interactions (target_type, target_id, kind, visitor_key, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(targetType, targetId, kind, key, now());
    if (inserted.changes > 0) {
      db.prepare(
        `INSERT INTO content_metrics (target_type, target_id, ${kind}s)
         VALUES (?, ?, 1)
         ON CONFLICT(target_type, target_id) DO UPDATE SET ${kind}s = ${kind}s + 1`,
      ).run(targetType, targetId);
    }
  });
  transaction();
  return getContentMetrics(targetType, targetId);
}

export function toggleContentLike(targetType: ContentTarget, targetId: number, visitorKey: string): ContentMetrics & { liked: boolean } {
  const key = visitorKey.trim().slice(0, 128);
  if (!key) return { ...getContentMetrics(targetType, targetId), liked: false };
  const transaction = db.transaction(() => {
    const existing = db
      .prepare("SELECT 1 FROM content_interactions WHERE target_type = ? AND target_id = ? AND kind = 'like' AND visitor_key = ?")
      .get(targetType, targetId, key);
    if (existing) {
      db.prepare("DELETE FROM content_interactions WHERE target_type = ? AND target_id = ? AND kind = 'like' AND visitor_key = ?").run(targetType, targetId, key);
      db.prepare("UPDATE content_metrics SET likes = MAX(0, likes - 1) WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
      return false;
    }
    const inserted = db
      .prepare("INSERT OR IGNORE INTO content_interactions (target_type, target_id, kind, visitor_key, created_at) VALUES (?, ?, 'like', ?, ?)")
      .run(targetType, targetId, key, now());
    if (inserted.changes > 0) {
      db.prepare(
        `INSERT INTO content_metrics (target_type, target_id, likes)
         VALUES (?, ?, 1)
         ON CONFLICT(target_type, target_id) DO UPDATE SET likes = likes + 1`,
      ).run(targetType, targetId);
      return true;
    }
    return false;
  });
  const liked = transaction() as boolean;
  return { ...getContentMetrics(targetType, targetId), liked };
}

export function hasLiked(targetType: ContentTarget, targetId: number, visitorKey: string): boolean {
  const key = visitorKey.trim().slice(0, 128);
  if (!key) return false;
  return !!db
    .prepare("SELECT 1 FROM content_interactions WHERE target_type = ? AND target_id = ? AND kind = 'like' AND visitor_key = ?")
    .get(targetType, targetId, key);
}

/** 批量版：一次查询多个对象当前访客是否已点赞，避免列表页 N+1。 */
export function hasLikedBulk(targetType: ContentTarget, targetIds: number[], visitorKey: string): Map<number, boolean> {
  const ids = [...new Set(targetIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, boolean>();
  const key = visitorKey.trim().slice(0, 128);
  if (!key || ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT DISTINCT target_id FROM content_interactions WHERE target_type = ? AND kind = 'like' AND visitor_key = ? AND target_id IN (${placeholders})`,
    )
    .all(targetType, key, ...ids) as Array<{ target_id: number }>;
  for (const row of rows) result.set(row.target_id, true);
  return result;
}

export function deleteContentInteractions(targetType: ContentTarget, targetId: number): void {
  db.prepare("DELETE FROM content_interactions WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
  db.prepare("DELETE FROM content_metrics WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
}
