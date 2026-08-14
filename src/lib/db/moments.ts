// 想法 DAO。
import { db, now } from "./core";
import type { Moment } from "./types";

/** 想法列表。传 options 时走 SQL 分页，不传则返回全部（首页/归档合并时间流依赖全量）。 */
export function listMoments(options?: { limit?: number; offset?: number }): Moment[] {
  const { limit, offset } = options ?? {};
  let sql = "SELECT * FROM moments ORDER BY created_at DESC";
  const params: Array<number> = [];
  if (Number.isInteger(limit) && (limit as number) > 0) {
    sql += " LIMIT ?";
    params.push(limit as number);
    if (Number.isInteger(offset) && (offset as number) > 0) {
      sql += " OFFSET ?";
      params.push(offset as number);
    }
  }
  return db.prepare(sql).all(...params) as Moment[];
}

export function getMoment(id: number): Moment | undefined {
  return db.prepare("SELECT * FROM moments WHERE id = ?").get(id) as Moment | undefined;
}

export function createMoment(data: { content: string; images?: string[] }): Moment {
  const ts = now();
  const info = db
    .prepare("INSERT INTO moments (content, images, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(data.content, JSON.stringify(data.images ?? []), ts, ts);
  return getMoment(Number(info.lastInsertRowid))!;
}

export function updateMoment(id: number, data: { content: string; images?: string[] }): Moment | undefined {
  db.prepare("UPDATE moments SET content = ?, images = ?, updated_at = ? WHERE id = ?").run(
    data.content,
    JSON.stringify(data.images ?? []),
    now(),
    id,
  );
  return getMoment(id);
}

export function deleteMoment(id: number): void {
  const transaction = db.transaction(() => {
    db.prepare("DELETE FROM comments WHERE target_type = 'moment' AND target_id = ?").run(id);
    db.prepare("DELETE FROM content_interactions WHERE target_type = 'moment' AND target_id = ?").run(id);
    db.prepare("DELETE FROM content_metrics WHERE target_type = 'moment' AND target_id = ?").run(id);
    db.prepare("DELETE FROM moments WHERE id = ?").run(id);
  });
  transaction();
}

export function countMoments(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM moments").get() as { c: number }).c;
}
