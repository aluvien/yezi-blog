// 文章 DAO。依赖 core（db/now）+ types + 纯工具模块。
import { db, now } from "./core";
import type { Post } from "./types";
import { slugify } from "@/lib/slug";
import { normalizePostTags, parsePostTags } from "@/lib/post-tags";

/** 未填 slug 时从标题生成（标题无法生成有效 slug 则用时间戳），并保证唯一 */
export function ensureUniqueSlug(input: string, title: string, excludeId?: number): string {
  let base = input.trim() ? slugify(input) : slugify(title);
  if (!base) base = `post-${Date.now().toString(36)}`;
  let slug = base;
  let n = 2;
  const stmt = db.prepare("SELECT id FROM posts WHERE slug = ?");
  while (true) {
    const row = stmt.get(slug) as { id: number } | undefined;
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${n++}`;
  }
}

/** 已发布文章列表。传 options 时走 SQL 分页（LIMIT/OFFSET），不传则返回全部（内存过滤型调用方仍依赖全量）。 */
export function listPosts(options?: { limit?: number; offset?: number }): Post[] {
  const { limit, offset } = options ?? {};
  let sql = "SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC";
  const params: Array<number> = [];
  if (Number.isInteger(limit) && (limit as number) > 0) {
    sql += " LIMIT ?";
    params.push(limit as number);
    if (Number.isInteger(offset) && (offset as number) > 0) {
      sql += " OFFSET ?";
      params.push(offset as number);
    }
  }
  return db.prepare(sql).all(...params) as Post[];
}

// tags 存为 JSON 字符串，无法用 SQL 索引查询，这里先在内存过滤。
// 数据量超过约 500 篇后应重构：FTS5 全文搜索，或拆为 post_tags(post_id, tag) 关系表 + 索引。
export function listPostsByTag(tag: string): Post[] {
  const needle = tag.trim().toLocaleLowerCase();
  if (!needle) return [];
  // 标签保存在 JSON 文本中，无法直接使用普通索引；先只取 tags 找到匹配 id，
  // 再读取命中的文章正文，避免标签页为每篇文章加载完整 Markdown。
  const rows = db.prepare("SELECT id, tags FROM posts WHERE status = 'published'").all() as Array<{ id: number; tags: string }>;
  const ids = rows
    .filter((row) => parsePostTags(row.tags).some((item) => item.toLocaleLowerCase() === needle))
    .map((row) => row.id);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db.prepare(`SELECT * FROM posts WHERE status = 'published' AND id IN (${placeholders}) ORDER BY created_at DESC`).all(...ids) as Post[];
}

// 分类筛选直接走索引，避免读取所有文章正文后再在内存过滤。
export function listPostsByCategory(category: string): Post[] {
  const needle = category.trim();
  if (!needle) return [];
  return db.prepare("SELECT * FROM posts WHERE status = 'published' AND category = ? COLLATE NOCASE ORDER BY created_at DESC").all(needle) as Post[];
}

/** 后台用：包含草稿与已发布文章。 */
export function listAllPosts(options?: { limit?: number; offset?: number }): Post[] {
  const { limit, offset } = options ?? {};
  let sql = "SELECT * FROM posts ORDER BY created_at DESC";
  const params: Array<number> = [];
  if (Number.isInteger(limit) && (limit as number) > 0) {
    sql += " LIMIT ?";
    params.push(limit as number);
    if (Number.isInteger(offset) && (offset as number) > 0) {
      sql += " OFFSET ?";
      params.push(offset as number);
    }
  }
  return db.prepare(sql).all(...params) as Post[];
}

/** 后台仪表盘用：按时间读取少量文章，避免把所有正文加载进内存。 */
export function listRecentPosts(limit = 5): Post[] {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  return listAllPosts({ limit: safeLimit });
}

export function getPost(id: number): Post | undefined {
  return db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as Post | undefined;
}

export function getPostBySlug(slug: string): Post | undefined {
  let normalized = slug;
  try {
    normalized = decodeURIComponent(slug);
  } catch {
    // 非法百分号编码按原值查询，由上层自然返回 404。
  }
  return db.prepare("SELECT * FROM posts WHERE slug = ? AND status = 'published'").get(normalized) as Post | undefined;
}

export function createPost(data: {
  title: string;
  slug?: string;
  content: string;
  cover?: string | null;
  category?: string;
  tags?: string[];
  status?: "draft" | "published";
}): Post {
  const slug = ensureUniqueSlug(data.slug ?? "", data.title);
  const ts = now();
  const info = db
    .prepare("INSERT INTO posts (title, slug, content, cover, category, tags, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(data.title, slug, data.content, data.cover ?? null, data.category?.trim() ?? "", JSON.stringify(normalizePostTags(data.tags)), ts, ts, data.status ?? "published");
  return getPost(Number(info.lastInsertRowid))!;
}

export function updatePost(
  id: number,
  data: {
    title: string;
    slug?: string;
    content: string;
    cover?: string | null;
    category?: string;
    tags?: string[];
    status?: "draft" | "published";
  },
): Post | undefined {
  const slug = ensureUniqueSlug(data.slug ?? "", data.title, id);
  db.prepare("UPDATE posts SET title = ?, slug = ?, content = ?, cover = ?, category = ?, tags = ?, status = ?, updated_at = ? WHERE id = ?").run(
    data.title,
    slug,
    data.content,
    data.cover ?? null,
    data.category?.trim() ?? "",
    JSON.stringify(normalizePostTags(data.tags)),
    data.status ?? "published",
    now(),
    id,
  );
  return getPost(id);
}

export function deletePost(id: number): void {
  const transaction = db.transaction(() => {
    db.prepare("UPDATE attachments SET post_id = NULL WHERE post_id = ?").run(id);
    db.prepare("DELETE FROM comments WHERE target_type = 'post' AND target_id = ?").run(id);
    db.prepare("DELETE FROM content_interactions WHERE target_type = 'post' AND target_id = ?").run(id);
    db.prepare("DELETE FROM content_metrics WHERE target_type = 'post' AND target_id = ?").run(id);
    db.prepare("DELETE FROM article_references WHERE post_id = ?").run(id);
    db.prepare("DELETE FROM posts WHERE id = ?").run(id);
  });
  transaction();
}

export function countPosts(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM posts").get() as { c: number }).c;
}

/** 仅统计已发布文章（含草稿的总数见 countPosts）。 */
export function countPublishedPosts(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status = 'published'").get() as { c: number }).c;
}

/**
 * 获取相关文章：按共享标签 + 同分类打分（共享标签每个 +2、同分类 +1），
 * 同分按时间倒序。没有明显相关文章时退化为最近发布，保持与旧行为一致。
 */
export function listRelatedPosts(currentId: number, limit = 3): Post[] {
  const current = getPost(currentId);
  if (!current) return [];
  const currentTags = new Set(parsePostTags(current.tags).map((tag) => tag.toLocaleLowerCase()));
  const categoryKey = (current.category ?? "").trim().toLocaleLowerCase();
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  // 一次性多取一些候选，避免每篇相关文章都加载全量正文；最终按分数截断。
  const candidates = db
    .prepare("SELECT * FROM posts WHERE id != ? AND status = 'published' ORDER BY created_at DESC LIMIT ?")
    .all(currentId, Math.min(200, safeLimit * 8)) as Post[];
  const scored = candidates.map((post) => {
    let score = 0;
    if (categoryKey && (post.category ?? "").trim().toLocaleLowerCase() === categoryKey) score += 1;
    for (const tag of parsePostTags(post.tags)) {
      if (currentTags.has(tag.toLocaleLowerCase())) score += 2;
    }
    return { post, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || new Date(b.post.created_at).getTime() - new Date(a.post.created_at).getTime())
    .slice(0, safeLimit)
    .map((item) => item.post);
}
