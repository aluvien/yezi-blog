// 小记统一时间流（Life Feed）。沿用 feed.ts 的架构：SQL 只查轻量 (type,id,sort_time)
// 并在数据库层排序 + LIMIT/OFFSET，再按类型批量水合本页 id，绝不全量读进内存再 JS 排序。
//
// 时间语义（按产品含义，不可混用）：
//   生活节点 → occurred_at（事情发生的时间）
//   作品     → created_at （无真实发布日期，第一版用录入时间；不用 sort_order）
//   GitHub   → registered_at（何时登记进小记；不用 synced_at）
//   收藏引用 → saved_at   （何时收藏；不用 published_at）
import { db } from "./core";
import type { LifeEvent } from "./types";
import type { ReferenceLibraryItem, Work, GithubRepository } from "./types";
import { getLifeEventsByIds } from "./life-events";
import { getWorksByIds } from "./works";
import { getGithubRepositoriesByIds } from "./github-repositories";
import { getReferencesByIds } from "./references";

export type LifeFeedType = "life_event" | "work" | "github_repository" | "reference";

export type LifeFeedItem =
  | { type: "life_event"; id: number; sort_time: string; value: LifeEvent }
  | { type: "work"; id: number; sort_time: string; value: Work }
  | { type: "github_repository"; id: number; sort_time: string; value: GithubRepository }
  | { type: "reference"; id: number; sort_time: string; value: ReferenceLibraryItem };

type FeedReference = { type: LifeFeedType; id: number; sort_time: string };

const LIFE_FEED_UNION = `
  SELECT 'life_event' AS type, id, occurred_at AS sort_time FROM life_events
  UNION ALL
  SELECT 'work' AS type, id, created_at AS sort_time FROM works
  UNION ALL
  SELECT 'github_repository' AS type, id, registered_at AS sort_time FROM github_repositories
  UNION ALL
  SELECT 'reference' AS type, id, COALESCE(NULLIF(saved_at, ''), created_at) AS sort_time FROM reference_library
`;

export function countLifeFeedItems(): number {
  const row = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM life_events)
      + (SELECT COUNT(*) FROM works)
      + (SELECT COUNT(*) FROM github_repositories)
      + (SELECT COUNT(*) FROM reference_library) AS count
  `).get() as { count: number };
  return Number(row.count) || 0;
}

/**
 * 分页取回一页小记条目。sort_time 为 ISO 字符串，字典序即时间序，跨类型可直接排序。
 * reference_library 的 saved_at 可能为 NULL（旧行未回填时回退 created_at），故用 COALESCE 兜底。
 */
export function listLifeFeedPage(limit: number, offset: number): LifeFeedItem[] {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const safeOffset = Math.max(0, Math.trunc(offset));
  const references = db.prepare(`
    SELECT type, id, sort_time
    FROM (${LIFE_FEED_UNION})
    ORDER BY sort_time DESC, id DESC
    LIMIT ? OFFSET ?
  `).all(safeLimit, safeOffset) as FeedReference[];
  if (references.length === 0) return [];

  const byType = (type: LifeFeedType) => references.filter((item) => item.type === type).map((item) => item.id);
  const lifeEvents = getLifeEventsByIds(byType("life_event"));
  const works = getWorksByIds(byType("work"));
  const repositories = getGithubRepositoriesByIds(byType("github_repository"));
  const references_ = getReferencesByIds(byType("reference"));

  const items: LifeFeedItem[] = [];
  for (const reference of references) {
    if (reference.type === "life_event") {
      const value = lifeEvents.get(reference.id);
      if (value) items.push({ type: "life_event", id: reference.id, sort_time: reference.sort_time, value });
    } else if (reference.type === "work") {
      const value = works.get(reference.id);
      if (value) items.push({ type: "work", id: reference.id, sort_time: reference.sort_time, value });
    } else if (reference.type === "github_repository") {
      const value = repositories.get(reference.id);
      if (value) items.push({ type: "github_repository", id: reference.id, sort_time: reference.sort_time, value });
    } else {
      const value = references_.get(reference.id);
      if (value) items.push({ type: "reference", id: reference.id, sort_time: reference.sort_time, value });
    }
  }
  return items;
}
