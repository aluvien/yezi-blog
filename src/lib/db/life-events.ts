// 生活节点（life_events）DAO。独立于絮语（moments）：絮语是当时的原始记录，
// 生活节点是后来整理的人生时间索引。删除来源絮语只断开关系（外键 ON DELETE
// SET NULL），绝不删除节点本身。
import { db, now } from "./core";
import type { LifeEvent } from "./types";
import { normalizePostTags } from "@/lib/post-tags";
import { normalizeLifeEventLocation } from "@/lib/life-events";
import type { LifeDatePrecision } from "@/lib/life-events";

/** 归一化图片为 JSON 数组字符串；非法（超长/非字符串项）返回 [] 的 JSON。 */
function normalizeImages(value: unknown): string {
  if (!Array.isArray(value)) return "[]";
  const images = [...new Set(value.map((item) => String(item ?? "").trim()).filter(Boolean))]
    .filter((image) => image.length <= 2_000)
    .slice(0, 9);
  return JSON.stringify(images);
}

function normalizeLocation(value: unknown): string {
  return normalizeLifeEventLocation(value) ?? "";
}

export type LifeEventInput = {
  title: string;
  content: string;
  occurred_at: string;
  date_precision: LifeDatePrecision;
  cover?: string | null;
  images?: string[];
  tags?: string[];
  location?: string;
  source_type?: "manual" | "moment";
  source_moment_id?: number | null;
};

/** 同一源絮语只能直接提取一个节点；命中唯一索引时抛错，由服务层转成可读提示。 */
export function createLifeEvent(data: LifeEventInput): LifeEvent {
  const ts = now();
  const info = db.prepare(`
    INSERT INTO life_events
      (title, content, occurred_at, date_precision, cover, images, tags, location, source_type, source_moment_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    data.title,
    data.content,
    data.occurred_at,
    data.date_precision,
    data.cover ?? null,
    normalizeImages(data.images),
    JSON.stringify(normalizePostTags(data.tags ?? [])),
    normalizeLocation(data.location),
    data.source_type ?? "manual",
    data.source_moment_id ?? null,
    ts,
    ts,
  );
  return getLifeEvent(Number(info.lastInsertRowid))!;
}

export function updateLifeEvent(id: number, data: Partial<Omit<LifeEventInput, "source_type" | "source_moment_id">>): LifeEvent | undefined {
  const current = getLifeEvent(id);
  if (!current) return undefined;
  const nextTitle = data.title === undefined ? current.title : data.title;
  const nextContent = data.content === undefined ? current.content : data.content;
  const nextOccurredAt = data.occurred_at === undefined ? current.occurred_at : data.occurred_at;
  const nextPrecision = data.date_precision === undefined ? current.date_precision : data.date_precision;
  const nextCover = data.cover === undefined ? current.cover : data.cover;
  const nextImages = data.images === undefined ? current.images : normalizeImages(data.images);
  const nextTags = data.tags === undefined ? current.tags : JSON.stringify(normalizePostTags(data.tags));
  const nextLocation = data.location === undefined ? current.location : normalizeLocation(data.location);
  db.prepare(`
    UPDATE life_events
    SET title = ?, content = ?, occurred_at = ?, date_precision = ?, cover = ?, images = ?, tags = ?, location = ?, updated_at = ?
    WHERE id = ?
  `).run(
    nextTitle,
    nextContent,
    nextOccurredAt,
    nextPrecision,
    nextCover ?? null,
    nextImages,
    nextTags,
    nextLocation,
    now(),
    id,
  );
  return getLifeEvent(id);
}

export function deleteLifeEvent(id: number): void {
  const transaction = db.transaction(() => {
    // 只断开与引用资料的宽泛关联；来源絮语完全保留（外键不会反向删除）。
    db.prepare("DELETE FROM reference_relations WHERE target_type = 'life_event' AND target_id = ?").run(id);
    db.prepare("DELETE FROM life_events WHERE id = ?").run(id);
  });
  transaction();
}

export function getLifeEvent(id: number): LifeEvent | undefined {
  if (!Number.isInteger(id) || id <= 0) return undefined;
  return db.prepare("SELECT * FROM life_events WHERE id = ?").get(id) as LifeEvent | undefined;
}

export function getLifeEventBySourceMoment(momentId: number): LifeEvent | undefined {
  if (!Number.isInteger(momentId) || momentId <= 0) return undefined;
  return db.prepare("SELECT * FROM life_events WHERE source_moment_id = ?").get(momentId) as LifeEvent | undefined;
}

export type LifeEventListOptions = {
  limit?: number;
  offset?: number;
  keyword?: string;
  tag?: string;
  /** 只列出「来自絮语」或「手动」的节点。 */
  source?: "manual" | "moment";
};

function lifeEventWhere(options: Pick<LifeEventListOptions, "keyword" | "tag" | "source">): { where: string; parameters: (string | number)[] } {
  const conditions: string[] = [];
  const parameters: (string | number)[] = [];
  const keyword = String(options.keyword ?? "").trim().slice(0, 120);
  const tag = String(options.tag ?? "").trim().replace(/^#+/, "").slice(0, 80);
  if (keyword) {
    conditions.push("(instr(lower(title), lower(?)) > 0 OR instr(lower(content), lower(?)) > 0)");
    parameters.push(keyword, keyword);
  }
  if (tag) {
    conditions.push("EXISTS (SELECT 1 FROM json_each(tags) WHERE lower(json_each.value) = lower(?))");
    parameters.push(tag);
  }
  if (options.source === "manual" || options.source === "moment") {
    conditions.push("source_type = ?");
    parameters.push(options.source);
  }
  return { where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "", parameters };
}

/** 列表默认按 occurred_at DESC（事情发生的时间），不是 created_at。 */
export function listLifeEvents(options: LifeEventListOptions = {}): LifeEvent[] {
  const { where, parameters } = lifeEventWhere(options);
  const { limit, offset } = options;
  let sql = `SELECT * FROM life_events ${where} ORDER BY occurred_at DESC, id DESC`;
  const params = [...parameters];
  if (Number.isInteger(limit) && (limit as number) > 0) {
    sql += " LIMIT ?";
    params.push(limit as number);
    if (Number.isInteger(offset) && (offset as number) > 0) {
      sql += " OFFSET ?";
      params.push(offset as number);
    }
  }
  return db.prepare(sql).all(...params) as LifeEvent[];
}

export function countLifeEvents(options: Pick<LifeEventListOptions, "keyword" | "tag" | "source"> = {}): number {
  const { where, parameters } = lifeEventWhere(options);
  return Number((db.prepare(`SELECT COUNT(*) AS c FROM life_events ${where}`).get(...parameters) as { c: number }).c);
}

/** 批量水合，供小记统一时间流按 id 取回本页节点，避免 N+1。 */
export function getLifeEventsByIds(ids: number[]): Map<number, LifeEvent> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  const map = new Map<number, LifeEvent>();
  if (unique.length === 0) return map;
  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM life_events WHERE id IN (${placeholders})`).all(...unique) as LifeEvent[];
  for (const row of rows) map.set(row.id, row);
  return map;
}

/** 供提取流程做「已提取」标记：一次查询返回这些絮语里哪些已生成节点。 */
export function lifeEventMomentIdsWithNode(momentIds: number[]): Set<number> {
  const unique = [...new Set(momentIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Set<number>();
  if (unique.length === 0) return result;
  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(`SELECT source_moment_id FROM life_events WHERE source_moment_id IN (${placeholders})`).all(...unique) as Array<{ source_moment_id: number }>;
  for (const row of rows) result.add(row.source_moment_id);
  return result;
}

/** 一次查询返回「源絮语 → 生活节点 id」映射，供絮语后台批量标注提取状态，避免逐行查询。 */
export function lifeEventNodeMapByMoment(): Map<number, number> {
  const rows = db.prepare("SELECT id, source_moment_id FROM life_events WHERE source_moment_id IS NOT NULL").all() as Array<{ id: number; source_moment_id: number }>;
  return new Map(rows.map((row) => [row.source_moment_id, row.id]));
}
