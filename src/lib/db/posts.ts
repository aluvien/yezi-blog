// 文章 DAO。依赖 core（db/now）+ types + 纯工具模块。
import { db, now } from "./core";
import type { Post } from "./types";
import { slugify } from "@/lib/slug";
import { normalizePostTags, parsePostTags } from "@/lib/post-tags";
import { normalizeTagKey, replacePostTagRelations } from "./post-tags";

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

// posts.tags 保留为兼容字段；标签页通过 post_tags 的 normalized_tag 索引查询，避免读取所有正文。
export function listPostsByTag(tag: string): Post[] {
  const needle = normalizeTagKey(tag);
  if (!needle) return [];
  return db.prepare(`
    SELECT posts.*
    FROM post_tags INDEXED BY idx_post_tags_normalized_tag_post_id
    INNER JOIN posts ON posts.id = post_tags.post_id
    WHERE post_tags.normalized_tag = ? AND posts.status = 'published'
    ORDER BY posts.created_at DESC
  `).all(needle) as Post[];
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
  const tags = normalizePostTags(data.tags);
  const id = db.transaction(() => {
    const info = db
      .prepare("INSERT INTO posts (title, slug, content, cover, category, tags, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(data.title, slug, data.content, data.cover ?? null, data.category?.trim() ?? "", JSON.stringify(tags), ts, ts, data.status ?? "published");
    const postId = Number(info.lastInsertRowid);
    replacePostTagRelations(postId, tags);
    return postId;
  })();
  return getPost(id)!;
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
  const tags = normalizePostTags(data.tags);
  db.transaction(() => {
    const info = db.prepare("UPDATE posts SET title = ?, slug = ?, content = ?, cover = ?, category = ?, tags = ?, status = ?, updated_at = ? WHERE id = ?").run(
      data.title,
      slug,
      data.content,
      data.cover ?? null,
      data.category?.trim() ?? "",
      JSON.stringify(tags),
      data.status ?? "published",
      now(),
      id,
    );
    if (info.changes > 0) replacePostTagRelations(id, tags);
  })();
  return getPost(id);
}

export function deletePost(id: number): void {
  const transaction = db.transaction(() => {
    db.prepare("UPDATE attachments SET post_id = NULL WHERE post_id = ?").run(id);
    db.prepare("DELETE FROM comments WHERE target_type = 'post' AND target_id = ?").run(id);
    db.prepare("DELETE FROM content_interactions WHERE target_type = 'post' AND target_id = ?").run(id);
    db.prepare("DELETE FROM content_metrics WHERE target_type = 'post' AND target_id = ?").run(id);
    db.prepare("DELETE FROM article_references WHERE post_id = ?").run(id);
    db.prepare("DELETE FROM post_tags WHERE post_id = ?").run(id);
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
  const currentTags = [...new Set(parsePostTags(current.tags).map(normalizeTagKey).filter(Boolean))];
  const category = (current.category ?? "").trim();
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const relevanceParts: string[] = [];
  const params: Array<string | number> = [];
  if (category) {
    relevanceParts.push("CASE WHEN p.category = ? COLLATE NOCASE THEN 1 ELSE 0 END");
    params.push(category);
  }
  if (currentTags.length > 0) {
    relevanceParts.push(`2 * COUNT(CASE WHEN pt.normalized_tag IN (${currentTags.map(() => "?").join(",")}) THEN 1 END)`);
    params.push(...currentTags);
  }

  let related: Post[] = [];
  if (relevanceParts.length > 0) {
    const relevance = relevanceParts.join(" + ");
    related = db.prepare(`
      SELECT p.*, ${relevance} AS relevance
      FROM posts p
      LEFT JOIN post_tags pt ON pt.post_id = p.id
      WHERE p.id != ? AND p.status = 'published'
      GROUP BY p.id
      HAVING relevance > 0
      ORDER BY relevance DESC, p.created_at DESC
      LIMIT ?
    `).all(...params, currentId, safeLimit) as Post[];
  }

  // 相关项不足时仍以最近文章补齐，保持旧页面不会因标签稀少而显得空洞。
  const remaining = safeLimit - related.length;
  if (remaining <= 0) return related;
  const excluded = [currentId, ...related.map((post) => post.id)];
  const fallback = db.prepare(`
    SELECT * FROM posts
    WHERE status = 'published' AND id NOT IN (${excluded.map(() => "?").join(",")})
    ORDER BY created_at DESC
    LIMIT ?
  `).all(...excluded, remaining) as Post[];
  return [...related, ...fallback];
}
