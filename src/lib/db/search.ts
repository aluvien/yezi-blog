// 全文搜索（FTS5 trigram）。结果始终用 includes 精确过滤，保证与旧版内存搜索一致。
import { db } from "./core";
import type { Post, Moment } from "./types";
import { parsePostTags } from "@/lib/post-tags";

// trigram tokenizer 需要至少 3 个字符才能做子串匹配；更短的查询使用有上限的回退扫描。
const FTS_MIN_QUERY_LENGTH = 3;
// 站内搜索是展示功能而不是导出接口。限制候选数避免短词、损坏索引或极宽 FTS
// 命中一次性把所有 Markdown 正文读进 Node 进程；个人博客中超过此数的命中对
// 搜索体验没有额外价值，分页也不会因此隐式加载未显示的完整正文。
export const SEARCH_CANDIDATE_LIMIT = 100;

/** 去掉 FTS5 查询语法里的特殊字符，避免 MATCH 表达式解析失败。 */
function ftsEscapeTerm(value: string): string {
  return value.replace(/["*^(){}[\]\\:]/g, " ");
}

/** Build a safe FTS phrase query, or return null to preserve the scan fallback. */
function ftsMatchQuery(query: string): string | null {
  const trimmed = query.trim();
  if (trimmed.length < FTS_MIN_QUERY_LENGTH) return null;
  const safe = ftsEscapeTerm(trimmed).replace(/\s+/g, " ").trim();
  if (safe.length < FTS_MIN_QUERY_LENGTH) return null;
  return `"${safe}"`;
}

/**
 * Query FTS and source rows in one statement. The old implementation built
 * one SQL placeholder per candidate ID, which grows without bound for broad
 * terms and can hit SQLite's variable limit on a large archive. Returning
 * null retains a bounded fallback for short or malformed MATCH input. An empty
 * array is a healthy FTS miss and must never trigger a fallback scan.
 */
function ftsCandidatePosts(query: string): Post[] | null {
  const match = ftsMatchQuery(query);
  if (!match) return null;
  try {
    return db.prepare(`
      SELECT posts.*
      FROM fts_posts
      INNER JOIN posts ON posts.id = fts_posts.rowid
      WHERE fts_posts MATCH ? AND posts.status = 'published'
      ORDER BY posts.created_at DESC
      LIMIT ?
    `).all(match, SEARCH_CANDIDATE_LIMIT) as Post[];
  } catch {
    return null;
  }
}

function ftsCandidateMoments(query: string): Moment[] | null {
  const match = ftsMatchQuery(query);
  if (!match) return null;
  try {
    return db.prepare(`
      SELECT moments.*
      FROM fts_moments
      INNER JOIN moments ON moments.id = fts_moments.rowid
      WHERE fts_moments MATCH ?
      ORDER BY moments.created_at DESC
      LIMIT ?
    `).all(match, SEARCH_CANDIDATE_LIMIT) as Moment[];
  } catch {
    return null;
  }
}

/** 文章是否命中搜索词：标题/正文/分类/标签任一包含（大小写不敏感）。 */
export function postMatchesSearch(post: Post, query: string): boolean {
  const needle = query.toLocaleLowerCase();
  return (
    post.title.toLocaleLowerCase().includes(needle) ||
    post.content.toLocaleLowerCase().includes(needle) ||
    (post.category ?? "").toLocaleLowerCase().includes(needle) ||
    parsePostTags(post.tags).some((tag) => tag.toLocaleLowerCase().includes(needle))
  );
}

/** 想法是否命中搜索词：正文包含（大小写不敏感）。 */
export function momentMatchesSearch(moment: Moment, query: string): boolean {
  return moment.content.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

function fallbackPosts(): Post[] {
  return db
    .prepare("SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC LIMIT ?")
    .all(SEARCH_CANDIDATE_LIMIT) as Post[];
}

function fallbackMoments(): Moment[] {
  return db
    .prepare("SELECT * FROM moments ORDER BY created_at DESC LIMIT ?")
    .all(SEARCH_CANDIDATE_LIMIT) as Moment[];
}

/** 已发布文章全文搜索：FTS5 缩小候选后按 includes 精确过滤，结果按时间倒序。 */
export function searchPosts(query: string): Post[] {
  const needle = query.trim();
  if (!needle) return [];
  const candidates = ftsCandidatePosts(needle);
  const rows = candidates ?? fallbackPosts();
  return rows
    .filter((post) => postMatchesSearch(post, needle))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/** 想法全文搜索：FTS5 缩小候选后按 includes 精确过滤，结果按时间倒序。 */
export function searchMoments(query: string): Moment[] {
  const needle = query.trim();
  if (!needle) return [];
  const candidates = ftsCandidateMoments(needle);
  const rows = candidates ?? fallbackMoments();
  return rows
    .filter((moment) => momentMatchesSearch(moment, needle))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
