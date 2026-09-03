// 收藏引用与其他内容之间的宽泛关联。与 article_references（文章发表时的稳定快照）
// 职责不同：reference_relations 表达“这份资料与哪些内容有关”，可在后台随时增删。
import { db, now } from "./core";
import type { ReferenceRelation, ReferenceTargetType } from "./types";

const TARGET_TYPES: readonly ReferenceTargetType[] = ["post", "life_event", "work", "github_repository"];

export function isReferenceTargetType(value: unknown): value is ReferenceTargetType {
  return TARGET_TYPES.includes(value as ReferenceTargetType);
}

/** 建立关联；重复的 (reference, target) 组合被静默忽略。 */
export function addReferenceRelation(input: { reference_id: number; target_type: ReferenceTargetType; target_id: number; context?: string }): boolean {
  if (!Number.isInteger(input.reference_id) || input.reference_id <= 0) return false;
  if (!Number.isInteger(input.target_id) || input.target_id <= 0) return false;
  if (!isReferenceTargetType(input.target_type)) return false;
  const reference = db.prepare("SELECT 1 FROM reference_library WHERE id = ?").get(input.reference_id);
  if (!reference) return false;
  return db.prepare(
    "INSERT OR IGNORE INTO reference_relations (reference_id, target_type, target_id, context, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(input.reference_id, input.target_type, input.target_id, String(input.context ?? "").trim().slice(0, 500), now()).changes > 0;
}

export function removeReferenceRelation(input: { reference_id: number; target_type: ReferenceTargetType; target_id: number }): boolean {
  return db.prepare("DELETE FROM reference_relations WHERE reference_id = ? AND target_type = ? AND target_id = ?")
    .run(input.reference_id, input.target_type, input.target_id).changes > 0;
}

export function listRelationsForReference(referenceId: number): ReferenceRelation[] {
  if (!Number.isInteger(referenceId) || referenceId <= 0) return [];
  return db.prepare("SELECT * FROM reference_relations WHERE reference_id = ? ORDER BY id ASC").all(referenceId) as ReferenceRelation[];
}

/** 一条资料在某类目标上关联了多少个，供列表页展示「关联内容：文章 2 · 作品 1 …」。 */
export function listReferenceRelationCounts(referenceId: number): Record<ReferenceTargetType, number> {
  const counts: Record<ReferenceTargetType, number> = { post: 0, life_event: 0, work: 0, github_repository: 0 };
  const rows = db.prepare("SELECT target_type, COUNT(*) AS count FROM reference_relations WHERE reference_id = ? GROUP BY target_type").all(referenceId) as Array<{ target_type: ReferenceTargetType; count: number }>;
  for (const row of rows) {
    if (isReferenceTargetType(row.target_type)) counts[row.target_type] = Number(row.count);
  }
  return counts;
}

/** 批量：一次查询取回多条资料各自的关联计数，避免资料列表 N+1。 */
export function listReferenceRelationCountsBulk(referenceIds: number[]): Map<number, Record<ReferenceTargetType, number>> {
  const unique = [...new Set(referenceIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, Record<ReferenceTargetType, number>>();
  if (unique.length === 0) return result;
  const empty = (): Record<ReferenceTargetType, number> => ({ post: 0, life_event: 0, work: 0, github_repository: 0 });
  for (const id of unique) result.set(id, empty());
  const placeholders = unique.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT reference_id, target_type, COUNT(*) AS count FROM reference_relations WHERE reference_id IN (${placeholders}) GROUP BY reference_id, target_type`,
  ).all(...unique) as Array<{ reference_id: number; target_type: ReferenceTargetType; count: number }>;
  for (const row of rows) {
    const bucket = result.get(row.reference_id);
    if (bucket && isReferenceTargetType(row.target_type)) bucket[row.target_type] = Number(row.count);
  }
  return result;
}

/** 删除来源内容时（如删生活节点/仓库）断开关联，避免脏引用；由各自 DAO 事务调用。 */
export function deleteRelationsByTarget(targetType: ReferenceTargetType, targetId: number): void {
  db.prepare("DELETE FROM reference_relations WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
}
