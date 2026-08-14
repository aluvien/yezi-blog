// 评论 DAO。
import { db, now } from "./core";
import { hashIp } from "@/lib/ip-hash";
import type { Comment, CommentWithTarget } from "./types";

/** 后台审核列表：pending 优先，组内按时间倒序，附带评论对象标签 */
export function listCommentsForAdmin(limit?: number): CommentWithTarget[] {
  const safeLimit = limit === undefined ? null : Math.min(100, Math.max(1, Math.trunc(limit)));
  const limitSql = safeLimit === null ? "" : " LIMIT ?";
  const params = safeLimit === null ? [] : [safeLimit];
  return db
    .prepare(
      `SELECT c.*,
        CASE c.target_type
          WHEN 'post' THEN (SELECT title FROM posts WHERE id = c.target_id)
          ELSE substr((SELECT content FROM moments WHERE id = c.target_id), 1, 50)
        END AS target_label,
        CASE c.target_type
          WHEN 'post' THEN (SELECT slug FROM posts WHERE id = c.target_id)
          ELSE NULL
        END AS target_slug
       FROM comments c
       ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC${limitSql}`,
    )
    .all(...params) as CommentWithTarget[];
}

/** 前台侧栏用：只取已审核的最近评论，避免读取后台待审核数据与全部评论正文。 */
export function listLatestApprovedComments(limit = 8): CommentWithTarget[] {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  return db
    .prepare(
      `SELECT c.*,
        CASE c.target_type
          WHEN 'post' THEN (SELECT title FROM posts WHERE id = c.target_id)
          ELSE substr((SELECT content FROM moments WHERE id = c.target_id), 1, 50)
        END AS target_label,
        CASE c.target_type
          WHEN 'post' THEN (SELECT slug FROM posts WHERE id = c.target_id)
          ELSE NULL
        END AS target_slug
       FROM comments c
       WHERE c.status = 'approved'
       ORDER BY c.created_at DESC
       LIMIT ?`,
    )
    .all(safeLimit) as CommentWithTarget[];
}

/** 前台用：某对象下已通过的评论，时间正序 */
export function listApprovedComments(targetType: "post" | "moment", targetId: number): Comment[] {
  return db
    .prepare("SELECT * FROM comments WHERE target_type = ? AND target_id = ? AND status = 'approved' ORDER BY created_at ASC")
    .all(targetType, targetId) as Comment[];
}

/** 前台用：某对象下已通过评论数 */
export function countApprovedComments(targetType: "post" | "moment", targetId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM comments WHERE target_type = ? AND target_id = ? AND status = 'approved'")
      .get(targetType, targetId) as { c: number }
  ).c;
}

/** 批量版：一次查询多个对象下的已通过评论数，避免列表页 N+1。 */
export function countApprovedCommentsBulk(targetType: "post" | "moment", targetIds: number[]): Map<number, number> {
  const ids = [...new Set(targetIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, number>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT target_id, COUNT(*) AS c FROM comments WHERE target_type = ? AND status = 'approved' AND target_id IN (${placeholders}) GROUP BY target_id`,
    )
    .all(targetType, ...ids) as Array<{ target_id: number; c: number }>;
  for (const row of rows) result.set(row.target_id, row.c);
  return result;
}

export function createComment(data: {
  target_type: "post" | "moment";
  target_id: number;
  nickname: string;
  email?: string | null;
  website?: string | null;
  content: string;
  ip: string;
}): Comment {
  const info = db
    .prepare(
      "INSERT INTO comments (target_type, target_id, nickname, email, website, content, ip, ip_address, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    )
    .run(data.target_type, data.target_id, data.nickname, data.email ?? null, data.website ?? null, data.content, hashIp(data.ip), data.ip.trim().slice(0, 100), now());
  return db.prepare("SELECT * FROM comments WHERE id = ?").get(Number(info.lastInsertRowid)) as Comment;
}

export function approveComment(id: number): void {
  db.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").run(id);
}

export function hideComment(id: number): void {
  db.prepare("UPDATE comments SET status = 'pending' WHERE id = ?").run(id);
}

export function updateCommentReply(id: number, reply: string | null): void {
  db.prepare("UPDATE comments SET admin_reply = ?, replied_at = ? WHERE id = ?").run(
    reply,
    reply ? now() : null,
    id,
  );
}

export function getComment(id: number): Comment | undefined {
  return db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as Comment | undefined;
}

export function deleteComment(id: number): void {
  db.prepare("DELETE FROM comments WHERE id = ?").run(id);
}

export function countPendingComments(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM comments WHERE status = 'pending'").get() as { c: number }).c;
}

/** 限频用：该 IP 最近一条评论距现在的毫秒数，无记录返回 null */
export function lastCommentAgeByIp(ip: string): number | null {
  const row = db
    .prepare("SELECT created_at FROM comments WHERE ip = ? ORDER BY created_at DESC LIMIT 1")
    .get(hashIp(ip)) as { created_at: string } | undefined;
  if (!row) return null;
  return Date.now() - new Date(row.created_at).getTime();
}

export function commentTargetExists(targetType: "post" | "moment", targetId: number): boolean {
  // 草稿文章不接受评论，否则评论区永远不可见还会积累垃圾数据
  if (targetType === "post") {
    return !!db.prepare("SELECT id FROM posts WHERE id = ? AND status = 'published'").get(targetId);
  }
  return !!db.prepare("SELECT id FROM moments WHERE id = ?").get(targetId);
}
