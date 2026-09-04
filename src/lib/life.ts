// 小记（/life）的读侧编排：Tab 归一化 + 分页参数 + 统一时间流取页。
// 与 home-feed 同思路：DB 层只做 UNION/排序/分页，这里负责「取一页 + 判断 hasMore」。
import {
  countLifeFeedItems,
  countLifeEvents,
  countGithubRepositories,
  countReferenceLibrary,
  countWorks,
  listGithubRepositories,
  listLifeEvents,
  listLifeFeedPage,
  listReferenceLibrary,
  listWorks,
} from "@/lib/db";
import type { LifeFeedItem } from "@/lib/db";

export const LIFE_TABS = ["all", "milestones", "works", "github", "references"] as const;
export type LifeTab = (typeof LIFE_TABS)[number];

export const LIFE_TAB_LABELS: Record<LifeTab, string> = {
  all: "全部",
  milestones: "生活节点",
  works: "作品",
  github: "GitHub",
  references: "收藏引用",
};

/** 小记各 Tab 的规范地址，供 Tabs 与分享链接复用；未知 type 回落全部。 */
export function lifeTabHref(type: LifeTab): string {
  return type === "all" ? "/life" : `/life?type=${type}`;
}

export function normalizeLifeTab(value: string | undefined): LifeTab {
  return (LIFE_TABS as readonly string[]).includes(value ?? "") ? (value as LifeTab) : "all";
}

function clampInt(value: string | number | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export type LifeFeedPage = { items: LifeFeedItem[]; total: number; page: number; limit: number; hasMore: boolean };

/** 统一时间流分页（type=all）。 */
export function getLifeFeedPage(searchParams: { type?: string; page?: string; limit?: string }): LifeFeedPage {
  const page = clampInt(searchParams.page, 1, 1, 10_000);
  const limit = clampInt(searchParams.limit, 12, 1, 30);
  const total = countLifeFeedItems();
  const offset = (page - 1) * limit;
  const items = offset >= total ? [] : listLifeFeedPage(limit, offset);
  return { items, total, page, limit, hasMore: offset + items.length < total };
}

export type LifeCounts = { all: number; milestones: number; works: number; github: number; references: number };

export function getLifeCounts(): LifeCounts {
  return {
    all: countLifeFeedItems(),
    milestones: countLifeEvents(),
    works: countWorks(),
    github: countGithubRepositories(),
    references: countReferenceLibrary(),
  };
}

/** 单 Tab 分页读取（type≠all）。四种集合都带类型，只有请求的那一类非空，避免调用方窄化困难。 */
export function getLifeTabData(type: Exclude<LifeTab, "all">, searchParams: { page?: string; limit?: string }) {
  const page = clampInt(searchParams.page, 1, 1, 10_000);
  const limit = clampInt(searchParams.limit, 12, 1, 40);
  const offset = (page - 1) * limit;
  const base = { page, limit, total: 0, milestones: [] as ReturnType<typeof listLifeEvents>, works: [] as ReturnType<typeof listWorks>, repositories: [] as ReturnType<typeof listGithubRepositories>, references: [] as ReturnType<typeof listReferenceLibrary> };
  if (type === "milestones") {
    base.total = countLifeEvents();
    base.milestones = listLifeEvents({ limit, offset });
  } else if (type === "works") {
    base.total = countWorks();
    base.works = listWorks({ limit, offset });
  } else if (type === "github") {
    base.total = countGithubRepositories();
    base.repositories = listGithubRepositories({ limit, offset });
  } else {
    base.total = countReferenceLibrary();
    base.references = listReferenceLibrary({ order: "saved", limit, offset });
  }
  return base;
}
