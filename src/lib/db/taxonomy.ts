// 分类 + 标签 DAO。
import { db, now } from "./core";
import { slugify } from "@/lib/slug";
import { normalizePostTags, parsePostTags } from "@/lib/post-tags";
import type { Category } from "./types";

export function listCategories(): Category[] {
  return db.prepare("SELECT * FROM categories ORDER BY name COLLATE NOCASE ASC").all() as Category[];
}

export function createCategory(name: string): Category | undefined {
  const normalized = name.trim().slice(0, 80);
  if (!normalized) return undefined;
  const slug = ensureUniqueCategorySlug(normalized);
  const info = db
    .prepare("INSERT OR IGNORE INTO categories (name, slug, created_at) VALUES (?, ?, ?)")
    .run(normalized, slug, now());
  if (info.changes > 0) return db.prepare("SELECT * FROM categories WHERE id = ?").get(Number(info.lastInsertRowid)) as Category | undefined;
  return db.prepare("SELECT * FROM categories WHERE name = ?").get(normalized) as Category | undefined;
}

export function updateCategory(id: number, name: string): Category | undefined {
  const current = db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category | undefined;
  const normalized = name.trim().slice(0, 80);
  if (!current || !normalized) return undefined;
  const duplicate = db.prepare("SELECT id FROM categories WHERE name = ? AND id != ?").get(normalized, id) as { id: number } | undefined;
  if (duplicate) return undefined;

  const slug = ensureUniqueCategorySlug(normalized, id);
  const timestamp = now();
  const transaction = db.transaction(() => {
    db.prepare("UPDATE categories SET name = ?, slug = ? WHERE id = ?").run(normalized, slug, id);
    db.prepare("UPDATE posts SET category = ?, updated_at = ? WHERE category = ?").run(normalized, timestamp, current.name);
  });
  transaction();
  return db.prepare("SELECT * FROM categories WHERE id = ?").get(id) as Category | undefined;
}

function ensureUniqueCategorySlug(name: string, excludeId?: number): string {
  const base = slugify(name) || `category-${Date.now().toString(36)}`;
  let slug = base;
  let suffix = 2;
  while (true) {
    const row = db.prepare("SELECT id FROM categories WHERE slug = ?").get(slug) as { id: number } | undefined;
    if (!row || row.id === excludeId) return slug;
    slug = `${base}-${suffix++}`;
  }
}

export function deleteCategory(id: number): void {
  const category = db.prepare("SELECT name FROM categories WHERE id = ?").get(id) as { name: string } | undefined;
  if (!category) return;
  const transaction = db.transaction(() => {
    const timestamp = now();
    db.prepare("UPDATE posts SET category = '', updated_at = ? WHERE category = ?").run(timestamp, category.name);
    db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  });
  transaction();
}

// ---------- tags ----------

/** 聚合所有文章已用标签及计数（后台 PostForm 建议/展示用）。 */
export function listAllTags(): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  const rows = db.prepare("SELECT tags FROM posts").all() as Array<{ tags: string }>;
  for (const row of rows) {
    for (const tag of parsePostTags(row.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

/** 后台仪表盘用：按最近文章出现顺序取标签，避免读取文章正文。 */
export function listRecentTags(limit = 5): string[] {
  const safeLimit = Math.min(50, Math.max(1, Math.trunc(limit)));
  const rows = db.prepare("SELECT created_at, tags FROM posts ORDER BY created_at DESC").all() as Array<{ created_at: string; tags: string }>;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const tag of parsePostTags(row.tags)) {
      const key = tag.toLocaleLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      result.push(tag);
      if (result.length >= safeLimit) return result;
    }
  }
  return result;
}

function canonicalTagName(value: string): string {
  return value.trim().replace(/^#+/, "").slice(0, 80);
}

function normalizeUniqueTags(tags: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const tag of normalizePostTags(tags)) {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

export function renameTag(oldTag: string, newTag: string): boolean {
  const from = canonicalTagName(oldTag);
  const to = canonicalTagName(newTag);
  if (!from || !to) return false;
  const fromKey = from.toLocaleLowerCase();
  const timestamp = now();
  const posts = db.prepare("SELECT id, tags FROM posts").all() as Array<{ id: number; tags: string }>;
  const update = db.prepare("UPDATE posts SET tags = ?, updated_at = ? WHERE id = ?");
  const transaction = db.transaction(() => {
    for (const post of posts) {
      const nextTags = normalizeUniqueTags(parsePostTags(post.tags).map((tag) => tag.toLocaleLowerCase() === fromKey ? to : tag));
      if (JSON.stringify(nextTags) !== JSON.stringify(parsePostTags(post.tags))) {
        update.run(JSON.stringify(nextTags), timestamp, post.id);
      }
    }
  });
  transaction();
  return true;
}

export function deleteTag(tag: string): boolean {
  const target = canonicalTagName(tag);
  if (!target) return false;
  const targetKey = target.toLocaleLowerCase();
  const timestamp = now();
  const posts = db.prepare("SELECT id, tags FROM posts").all() as Array<{ id: number; tags: string }>;
  const update = db.prepare("UPDATE posts SET tags = ?, updated_at = ? WHERE id = ?");
  const transaction = db.transaction(() => {
    for (const post of posts) {
      const nextTags = normalizeUniqueTags(parsePostTags(post.tags).filter((item) => item.toLocaleLowerCase() !== targetKey));
      if (JSON.stringify(nextTags) !== JSON.stringify(parsePostTags(post.tags))) {
        update.run(JSON.stringify(nextTags), timestamp, post.id);
      }
    }
  });
  transaction();
  return true;
}

/** 已发布文章的标签聚合（按计数降序，最多 limit 个），供前台侧栏与移动菜单共用。 */
export function listPublishedTags(limit = 12): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  const rows = db.prepare("SELECT tags FROM posts WHERE status = 'published'").all() as Array<{ tags: string }>;
  for (const row of rows) {
    for (const tag of parsePostTags(row.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"))
    .slice(0, limit);
}
