// 作品 DAO。
import { db, now } from "./core";
import type { Work } from "./types";

/** 作品列表。传 options 时走 SQL 分页，不传则返回全部。 */
export function listWorks(options?: { limit?: number; offset?: number }): Work[] {
  const { limit, offset } = options ?? {};
  let sql = "SELECT * FROM works ORDER BY sort_order ASC, created_at DESC";
  const params: Array<number> = [];
  if (Number.isInteger(limit) && (limit as number) > 0) {
    sql += " LIMIT ?";
    params.push(limit as number);
    if (Number.isInteger(offset) && (offset as number) > 0) {
      sql += " OFFSET ?";
      params.push(offset as number);
    }
  }
  return db.prepare(sql).all(...params) as Work[];
}

export function getWork(id: number): Work | undefined {
  return db.prepare("SELECT * FROM works WHERE id = ?").get(id) as Work | undefined;
}

export function createWork(data: {
  title: string;
  description?: string;
  cover?: string | null;
  link?: string | null;
  sort_order?: number;
}): Work {
  const info = db
    .prepare("INSERT INTO works (title, description, cover, link, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(data.title, data.description ?? "", data.cover ?? null, data.link ?? null, data.sort_order ?? 0, now());
  return getWork(Number(info.lastInsertRowid))!;
}

export function updateWork(
  id: number,
  data: { title: string; description?: string; cover?: string | null; link?: string | null; sort_order?: number },
): Work | undefined {
  db.prepare("UPDATE works SET title = ?, description = ?, cover = ?, link = ?, sort_order = ? WHERE id = ?").run(
    data.title,
    data.description ?? "",
    data.cover ?? null,
    data.link ?? null,
    data.sort_order ?? 0,
    id,
  );
  return getWork(id);
}

export function deleteWork(id: number): void {
  db.prepare("DELETE FROM works WHERE id = ?").run(id);
}

export function countWorks(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM works").get() as { c: number }).c;
}
