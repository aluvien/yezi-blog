// 全文搜索（FTS5 trigram）。结果始终用 includes 精确过滤，保证与旧版内存搜索一致。
import { db } from "./core";
import type { Post, Moment } from "./types";
import { parsePostTags } from "@/lib/post-tags";

// trigram tokenizer 需要至少 3 个字符才能做子串匹配；更短的查询回退全量扫描。
const FTS_MIN_QUERY_LENGTH = 3;

/** 去掉 FTS5 查询语法里的特殊字符，避免 MATCH 表达式解析失败。 */
function ftsEscapeTerm(value: string): string {
  return value.replace(/["*^(){}[\]\\:]/g, " ");
}

/**
 * 用 FTS5 求候选 rowid 集。trigram 子串匹配与 includes 一致，因此 FTS 命中的
 * 一定包含 includes 会命中的全部结果（不漏）；调用方仍会用 includes 精确过滤，
 * 保证搜索结果与旧版内存扫描完全一致。MATCH 异常（例如清理后仍非法）时返回 null，
 * 由调用方回退全量扫描。
 */
function ftsCandidateRowIds(query: string, kind: "post" | "moment"): number[] | null {
  const trimmed = query.trim();
  if (trimmed.length < FTS_MIN_QUERY_LENGTH) return null;
  const safe = ftsEscapeTerm(trimmed).replace(/\s+/g, " ").trim();
  if (safe.length < FTS_MIN_QUERY_LENGTH) return null;
  const table = kind === "post" ? "fts_posts" : "fts_moments";
  try {
    const rows = db.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ?`).all(`"${safe}"`) as Array<{ rowid: number }>;
    return rows.map((row) => row.rowid);
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

/** 已发布文章全文搜索：FTS5 缩小候选后按 includes 精确过滤，结果按时间倒序。 */
export function searchPosts(query: string): Post[] {
  const needle = query.trim();
  if (!needle) return [];
  const candidateIds = ftsCandidateRowIds(needle, "post");
  const rows: Post[] =
    candidateIds && candidateIds.length > 0
      ? (db
          .prepare(`SELECT * FROM posts WHERE status = 'published' AND id IN (${candidateIds.map(() => "?").join(",")})`)
          .all(...candidateIds) as Post[])
      : (db.prepare("SELECT * FROM posts WHERE status = 'published'").all() as Post[]);
  return rows
    .filter((post) => postMatchesSearch(post, needle))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

/** 想法全文搜索：FTS5 缩小候选后按 includes 精确过滤，结果按时间倒序。 */
export function searchMoments(query: string): Moment[] {
  const needle = query.trim();
  if (!needle) return [];
  const candidateIds = ftsCandidateRowIds(needle, "moment");
  const rows: Moment[] =
    candidateIds && candidateIds.length > 0
      ? (db.prepare(`SELECT * FROM moments WHERE id IN (${candidateIds.map(() => "?").join(",")})`).all(...candidateIds) as Moment[])
      : (db.prepare("SELECT * FROM moments").all() as Moment[]);
  return rows
    .filter((moment) => momentMatchesSearch(moment, needle))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}
