import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { normalizePostTags, parsePostTags } from "@/lib/post-tags";
import { hashIp } from "@/lib/request";

export { normalizePostTags, parsePostTags } from "@/lib/post-tags";
export { parseMomentImages } from "@/lib/moments";

const configuredDbPath = process.env.BLOG_DB_PATH?.trim();
const DB_PATH = configuredDbPath ? path.resolve(configuredDbPath) : path.join(process.cwd(), "data", "blog.db");
const DB_DIR = path.dirname(DB_PATH);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function createDb(): Database.Database {
  fs.mkdirSync(DB_DIR, { recursive: true });
  // build 期多个 worker 进程会同时加载本模块、并发建库建表，
  // busy_timeout 无法覆盖所有锁定路径（如 WAL 切换），失败时整体重试
  let lastErr: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const db = new Database(DB_PATH, { timeout: 5000 });
      db.pragma("journal_mode = WAL");
      db.exec(`
    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      cover TEXT,
      category TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS moments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      content TEXT NOT NULL,
      images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS works (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      cover TEXT,
      link TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL CHECK (target_type IN ('post','moment')),
      target_id INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      email TEXT,
      website TEXT,
      content TEXT NOT NULL,
      ip TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS attachments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER,
      path TEXT NOT NULL UNIQUE,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id, status);
    CREATE INDEX IF NOT EXISTS idx_comments_ip_time ON comments (ip, created_at);
    CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments (post_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS login_attempts (
      ip TEXT PRIMARY KEY,
      failed_count INTEGER NOT NULL DEFAULT 0,
      first_failed_at INTEGER NOT NULL,
      blocked_until INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS site_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content_metrics (
      target_type TEXT NOT NULL CHECK (target_type IN ('post','moment')),
      target_id INTEGER NOT NULL,
      views INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (target_type, target_id)
    );
    CREATE TABLE IF NOT EXISTS content_interactions (
      target_type TEXT NOT NULL CHECK (target_type IN ('post','moment')),
      target_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('view','like')),
      visitor_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (target_type, target_id, kind, visitor_key)
    );
    CREATE INDEX IF NOT EXISTS idx_content_interactions_time ON content_interactions (created_at);
  `);

      // 轻量迁移：旧数据库启动时自动补齐新字段。并发构建进程可能同时迁移，
      // 因此重复字段错误可以安全忽略。
      const ensureColumn = (table: string, column: string, definition: string) => {
        const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
        if (columns.some((item) => item.name === column)) return;
        try {
          db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        } catch (error) {
          if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
        }
      };
      ensureColumn("posts", "status", "TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published'))");
      ensureColumn("posts", "category", "TEXT NOT NULL DEFAULT ''");
      ensureColumn("posts", "tags", "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn("moments", "updated_at", "TEXT");
      ensureColumn("comments", "admin_reply", "TEXT");
      ensureColumn("comments", "replied_at", "TEXT");
      ensureColumn("comments", "website", "TEXT");
      db.prepare("UPDATE moments SET updated_at = created_at WHERE updated_at IS NULL").run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_posts_status_time ON posts (status, created_at DESC)");

      // 互动去重表按时间清理（保留 180 天），防止长期运行无限膨胀。
      // 只在进程启动时执行一次；过期记录被清理后，旧访客可再次点赞/计数，属可接受的取舍。
      db.prepare("DELETE FROM content_interactions WHERE created_at < ?").run(new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString());

      // 会话与登录失败记录同样只留短暂有效期：过期 session 删除；
      // login_attempts 保留 24 小时（远超 15 分钟限流/封禁窗口），随后清掉不再需要的历史失败记录。
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
      db.prepare("DELETE FROM login_attempts WHERE first_failed_at < ?").run(Date.now() - 24 * 60 * 60 * 1000);

      // 旧版本明文存储评论 IP，这里幂等迁移为 sha256 哈希（哈希固定 64 位 hex）。
      const staleIps = db
        .prepare("SELECT id, ip FROM comments WHERE ip != '' AND length(ip) != 64")
        .all() as Array<{ id: number; ip: string }>;
      const updateIp = db.prepare("UPDATE comments SET ip = ? WHERE id = ?");
      for (const row of staleIps) {
        if (row.ip && !/^[0-9a-f]{64}$/.test(row.ip)) updateIp.run(hashIp(row.ip), row.id);
      }
      return db;
    } catch (e) {
      lastErr = e;
      sleepSync(150);
    }
  }
  throw lastErr;
}

// 开发模式 HMR 会重复加载模块，用 globalThis 缓存避免重复连接
const globalForDb = globalThis as unknown as { __blogDb?: Database.Database };
export const db: Database.Database =
  globalForDb.__blogDb ?? (globalForDb.__blogDb = createDb());

// ---------- 类型 ----------

export interface Post {
  id: number;
  title: string;
  slug: string;
  content: string;
  cover: string | null;
  category: string;
  /** JSON 数组字符串，如 '["Next.js","设计"]' */
  tags: string;
  created_at: string;
  updated_at: string;
  status: "draft" | "published";
}

export interface Moment {
  id: number;
  content: string;
  /** JSON 数组字符串，如 '["/uploads/202607/a.jpg"]' */
  images: string;
  created_at: string;
  updated_at: string;
}

export interface Work {
  id: number;
  title: string;
  description: string;
  cover: string | null;
  link: string | null;
  sort_order: number;
  created_at: string;
}

export interface Comment {
  id: number;
  target_type: "post" | "moment";
  target_id: number;
  nickname: string;
  email: string | null;
  website: string | null;
  content: string;
  ip: string;
  status: "pending" | "approved";
  created_at: string;
  admin_reply: string | null;
  replied_at: string | null;
}

export interface CommentWithTarget extends Comment {
  /** 文章标题或想法内容摘要，目标已删除时为 null */
  target_label: string | null;
  target_slug: string | null;
}

export interface Attachment {
  id: number;
  post_id: number | null;
  path: string;
  original_name: string;
  mime_type: string;
  size: number;
  created_at: string;
}

export interface AttachmentReference {
  type: "post" | "moment" | "setting";
  id: number;
  label: string;
  slug?: string;
}

export interface AttachmentWithUsage extends Attachment {
  /** 引用此附件的文章/想法列表（按正文、封面、想法图片匹配） */
  references: AttachmentReference[];
  referenced: boolean;
}

export interface Session {
  id: string;
  created_at: string;
  expires_at: number;
}

export interface LoginAttempt {
  ip: string;
  failed_count: number;
  first_failed_at: number;
  blocked_until: number;
}

export interface SiteSetting {
  key: string;
  value: string;
  updated_at: string;
}

export interface Category {
  id: number;
  name: string;
  slug: string;
  created_at: string;
}

export interface ContentMetrics {
  views: number;
  likes: number;
}

export type ContentTarget = "post" | "moment";
export type InteractionKind = "view" | "like";

function now(): string {
  return new Date().toISOString();
}

// ---------- slug ----------

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

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

// ---------- posts ----------

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
  return listPosts().filter((post) => parsePostTags(post.tags).some((item) => item.toLocaleLowerCase() === needle));
}

// 分类筛选同标签：内存过滤，数据量大后应改为 posts.category 索引查询（category 列可加索引）。
export function listPostsByCategory(category: string): Post[] {
  const needle = category.trim().toLocaleLowerCase();
  if (!needle) return [];
  return listPosts().filter((post) => post.category.trim().toLocaleLowerCase() === needle);
}

/** 后台用：包含草稿与已发布文章。 */
export function listAllPosts(): Post[] {
  return db.prepare("SELECT * FROM posts ORDER BY created_at DESC").all() as Post[];
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
  db.prepare("UPDATE attachments SET post_id = NULL WHERE post_id = ?").run(id);
  db.prepare("DELETE FROM comments WHERE target_type = 'post' AND target_id = ?").run(id);
  deleteContentInteractions("post", id);
  db.prepare("DELETE FROM posts WHERE id = ?").run(id);
}

// ---------- attachments ----------

export function createAttachment(data: {
  path: string;
  original_name: string;
  mime_type: string;
  size: number;
  post_id?: number | null;
}): Attachment {
  const info = db
    .prepare("INSERT INTO attachments (post_id, path, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(data.post_id ?? null, data.path, data.original_name, data.mime_type, data.size, now());
  return db.prepare("SELECT * FROM attachments WHERE id = ?").get(Number(info.lastInsertRowid)) as Attachment;
}

export function getAttachment(id: number): Attachment | undefined {
  return db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as Attachment | undefined;
}

export function getPostAttachments(postId: number): Attachment[] {
  return db.prepare("SELECT * FROM attachments WHERE post_id = ? ORDER BY created_at DESC").all(postId) as Attachment[];
}

export function attachAttachmentsToPost(ids: number[], postId: number): void {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
  if (uniqueIds.length === 0) return;
  const placeholders = uniqueIds.map(() => "?").join(",");
  db.prepare(`UPDATE attachments SET post_id = ? WHERE id IN (${placeholders})`).run(postId, ...uniqueIds);
}

export function listAttachments(): AttachmentWithUsage[] {
  const rows = db.prepare("SELECT * FROM attachments ORDER BY created_at DESC").all() as Attachment[];
  const posts = db
    .prepare("SELECT id, title, slug, content, cover FROM posts")
    .all() as Array<{ id: number; title: string; slug: string; content: string; cover: string | null }>;
  const moments = db
    .prepare("SELECT id, content, images FROM moments")
    .all() as Array<{ id: number; content: string; images: string }>;
  const settings = getSiteSettings();
  return rows.map((row) => {
    const references: AttachmentReference[] = [];
    for (const post of posts) {
      if ((post.content && post.content.includes(row.path)) || (post.cover && post.cover === row.path)) {
        references.push({ type: "post", id: post.id, label: post.title, slug: post.slug });
      }
    }
    for (const moment of moments) {
      if (moment.images && moment.images.includes(row.path)) {
        const summary = moment.content.replace(/\s+/g, " ").trim().slice(0, 30);
        references.push({ type: "moment", id: moment.id, label: summary || "想法" });
      }
    }
    if (settings.site_logo && settings.site_logo === row.path) {
      references.push({ type: "setting", id: 0, label: "站点 Logo" });
    }
    if (settings.author_avatar && settings.author_avatar === row.path) {
      references.push({ type: "setting", id: 0, label: "作者头像" });
    }
    return { ...row, references, referenced: references.length > 0 };
  });
}

export function deleteAttachment(id: number): Attachment | undefined {
  const attachment = getAttachment(id);
  if (!attachment) return undefined;
  db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
  return attachment;
}

export function countPosts(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM posts").get() as { c: number }).c;
}

/** 仅统计已发布文章（含草稿的总数见 countPosts）。 */
export function countPublishedPosts(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM posts WHERE status = 'published'").get() as { c: number }).c;
}

/** 获取相关文章（排除当前文章，按时间倒序，最多 limit 篇） */
export function listRelatedPosts(currentId: number, limit = 3): Post[] {
  return db
    .prepare("SELECT * FROM posts WHERE id != ? AND status = 'published' ORDER BY created_at DESC LIMIT ?")
    .all(currentId, limit) as Post[];
}

// ---------- site settings / categories ----------

export function getSiteSettings(): Record<string, string> {
  const rows = db.prepare("SELECT key, value FROM site_settings ORDER BY key ASC").all() as Array<{ key: string; value: string }>;
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export function setSiteSettings(values: Record<string, string>): void {
  const statement = db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  );
  const transaction = db.transaction((entries: Array<[string, string]>) => {
    const timestamp = now();
    for (const [key, value] of entries) statement.run(key, value, timestamp);
  });
  transaction(Object.entries(values).map(([key, value]) => [key.trim(), String(value ?? "")]));
}

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
  return db.prepare("SELECT * FROM categories WHERE id = ? OR name = ?").get(Number(info.lastInsertRowid), normalized) as Category | undefined;
}

function ensureUniqueCategorySlug(name: string): string {
  // 注意：无 excludeId 参数，分类目前不可改名（仅创建/删除），重名分类改名会冲突。
  // 若未来支持分类改名，需要像 ensureUniqueSlug 那样传入排除 id。
  const base = slugify(name) || `category-${Date.now().toString(36)}`;
  let slug = base;
  let suffix = 2;
  while (db.prepare("SELECT id FROM categories WHERE slug = ?").get(slug)) slug = `${base}-${suffix++}`;
  return slug;
}

export function deleteCategory(id: number): void {
  const category = db.prepare("SELECT name FROM categories WHERE id = ?").get(id) as { name: string } | undefined;
  if (!category) return;
  db.prepare("UPDATE posts SET category = '' WHERE category = ?").run(category.name);
  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
}

// ---------- content metrics ----------

export function getContentMetrics(targetType: ContentTarget, targetId: number): ContentMetrics {
  const row = db
    .prepare("SELECT views, likes FROM content_metrics WHERE target_type = ? AND target_id = ?")
    .get(targetType, targetId) as ContentMetrics | undefined;
  return { views: row?.views ?? 0, likes: row?.likes ?? 0 };
}

export function getContentMetricsBulk(targetType: ContentTarget, targetIds: number[]): Map<number, ContentMetrics> {
  const ids = [...new Set(targetIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, ContentMetrics>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT target_id, views, likes FROM content_metrics WHERE target_type = ? AND target_id IN (${placeholders})`)
    .all(targetType, ...ids) as Array<{ target_id: number; views: number; likes: number }>;
  for (const row of rows) result.set(row.target_id, { views: row.views, likes: row.likes });
  return result;
}

export function getOverallMetrics(): ContentMetrics {
  const row = db.prepare("SELECT COALESCE(SUM(views), 0) AS views, COALESCE(SUM(likes), 0) AS likes FROM content_metrics").get() as ContentMetrics;
  return { views: Number(row.views) || 0, likes: Number(row.likes) || 0 };
}

export function recordContentInteraction(
  targetType: ContentTarget,
  targetId: number,
  kind: InteractionKind,
  visitorKey: string,
): ContentMetrics {
  const key = visitorKey.trim().slice(0, 128);
  if (!key) return getContentMetrics(targetType, targetId);
  const inserted = db
    .prepare("INSERT OR IGNORE INTO content_interactions (target_type, target_id, kind, visitor_key, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(targetType, targetId, kind, key, now());
  if (inserted.changes > 0) {
    db.prepare(
      `INSERT INTO content_metrics (target_type, target_id, ${kind}s)
       VALUES (?, ?, 1)
       ON CONFLICT(target_type, target_id) DO UPDATE SET ${kind}s = ${kind}s + 1`,
    ).run(targetType, targetId);
  }
  return getContentMetrics(targetType, targetId);
}

export function toggleContentLike(targetType: ContentTarget, targetId: number, visitorKey: string): ContentMetrics & { liked: boolean } {
  const key = visitorKey.trim().slice(0, 128);
  if (!key) return { ...getContentMetrics(targetType, targetId), liked: false };
  const existing = db
    .prepare("SELECT 1 FROM content_interactions WHERE target_type = ? AND target_id = ? AND kind = 'like' AND visitor_key = ?")
    .get(targetType, targetId, key);
  if (existing) {
    // 已点赞 -> 取消：删除互动记录并 likes -1
    db.prepare("DELETE FROM content_interactions WHERE target_type = ? AND target_id = ? AND kind = 'like' AND visitor_key = ?").run(targetType, targetId, key);
    db.prepare("UPDATE content_metrics SET likes = MAX(0, likes - 1) WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
  } else {
    // 未点赞 -> 点赞：插入记录并 likes +1
    const inserted = db
      .prepare("INSERT OR IGNORE INTO content_interactions (target_type, target_id, kind, visitor_key, created_at) VALUES (?, ?, 'like', ?, ?)")
      .run(targetType, targetId, key, now());
    if (inserted.changes > 0) {
      db.prepare(
        `INSERT INTO content_metrics (target_type, target_id, likes)
         VALUES (?, ?, 1)
         ON CONFLICT(target_type, target_id) DO UPDATE SET likes = likes + 1`,
      ).run(targetType, targetId);
    }
  }
  return { ...getContentMetrics(targetType, targetId), liked: !existing };
}

export function hasLiked(targetType: ContentTarget, targetId: number, visitorKey: string): boolean {
  const key = visitorKey.trim().slice(0, 128);
  if (!key) return false;
  return !!db
    .prepare("SELECT 1 FROM content_interactions WHERE target_type = ? AND target_id = ? AND kind = 'like' AND visitor_key = ?")
    .get(targetType, targetId, key);
}

/** 批量版：一次查询多个对象当前访客是否已点赞，避免列表页 N+1。 */
export function hasLikedBulk(targetType: ContentTarget, targetIds: number[], visitorKey: string): Map<number, boolean> {
  const ids = [...new Set(targetIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, boolean>();
  const key = visitorKey.trim().slice(0, 128);
  if (!key || ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT DISTINCT target_id FROM content_interactions WHERE target_type = ? AND kind = 'like' AND visitor_key = ? AND target_id IN (${placeholders})`,
    )
    .all(targetType, key, ...ids) as Array<{ target_id: number }>;
  for (const row of rows) result.set(row.target_id, true);
  return result;
}

export function deleteContentInteractions(targetType: ContentTarget, targetId: number): void {
  db.prepare("DELETE FROM content_interactions WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
  db.prepare("DELETE FROM content_metrics WHERE target_type = ? AND target_id = ?").run(targetType, targetId);
}

// ---------- moments ----------

/** 想法列表。传 options 时走 SQL 分页，不传则返回全部（首页/归档合并时间流依赖全量）。 */
export function listMoments(options?: { limit?: number; offset?: number }): Moment[] {
  const { limit, offset } = options ?? {};
  let sql = "SELECT * FROM moments ORDER BY created_at DESC";
  const params: Array<number> = [];
  if (Number.isInteger(limit) && (limit as number) > 0) {
    sql += " LIMIT ?";
    params.push(limit as number);
    if (Number.isInteger(offset) && (offset as number) > 0) {
      sql += " OFFSET ?";
      params.push(offset as number);
    }
  }
  return db.prepare(sql).all(...params) as Moment[];
}

export function getMoment(id: number): Moment | undefined {
  return db.prepare("SELECT * FROM moments WHERE id = ?").get(id) as Moment | undefined;
}

export function createMoment(data: { content: string; images?: string[] }): Moment {
  const ts = now();
  const info = db
    .prepare("INSERT INTO moments (content, images, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(data.content, JSON.stringify(data.images ?? []), ts, ts);
  return getMoment(Number(info.lastInsertRowid))!;
}

export function updateMoment(id: number, data: { content: string; images?: string[] }): Moment | undefined {
  db.prepare("UPDATE moments SET content = ?, images = ?, updated_at = ? WHERE id = ?").run(
    data.content,
    JSON.stringify(data.images ?? []),
    now(),
    id,
  );
  return getMoment(id);
}

export function deleteMoment(id: number): void {
  db.prepare("DELETE FROM comments WHERE target_type = 'moment' AND target_id = ?").run(id);
  deleteContentInteractions("moment", id);
  db.prepare("DELETE FROM moments WHERE id = ?").run(id);
}

export function countMoments(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM moments").get() as { c: number }).c;
}

// ---------- works ----------

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

export function countAttachments(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM attachments").get() as { c: number }).c;
}

/** 聚合所有文章已用标签及计数（后台 PostForm 建议/展示用）。 */
export function listAllTags(): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const post of listAllPosts()) {
    for (const tag of parsePostTags(post.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

/** 已发布文章的标签聚合（按计数降序，最多 limit 个），供前台侧栏与移动菜单共用。 */
export function listPublishedTags(limit = 12): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const post of listPosts()) {
    for (const tag of parsePostTags(post.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"))
    .slice(0, limit);
}

// ---------- comments ----------

/** 后台审核列表：pending 优先，组内按时间倒序，附带评论对象标签 */
export function listCommentsForAdmin(): CommentWithTarget[] {
  return db
    .prepare(
      `SELECT c.*,
        CASE c.target_type
          WHEN 'post' THEN (SELECT title FROM posts WHERE id = c.target_id)
          ELSE substr((SELECT content FROM moments WHERE id = c.target_id), 1, 50)
        END AS target_label,
        CASE c.target_type
          WHEN 'post' THEN (SELECT slug FROM posts WHERE id = c.target_id)
          ELSE NULL
        END AS target_slug
       FROM comments c
       ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC`,
    )
    .all() as CommentWithTarget[];
}

/** 前台用：某对象下已通过的评论，时间正序 */
export function listApprovedComments(targetType: "post" | "moment", targetId: number): Comment[] {
  return db
    .prepare("SELECT * FROM comments WHERE target_type = ? AND target_id = ? AND status = 'approved' ORDER BY created_at ASC")
    .all(targetType, targetId) as Comment[];
}

/** 前台用：某对象下已通过评论数 */
export function countApprovedComments(targetType: "post" | "moment", targetId: number): number {
  return (
    db
      .prepare("SELECT COUNT(*) AS c FROM comments WHERE target_type = ? AND target_id = ? AND status = 'approved'")
      .get(targetType, targetId) as { c: number }
  ).c;
}

/** 批量版：一次查询多个对象下的已通过评论数，避免列表页 N+1。 */
export function countApprovedCommentsBulk(targetType: "post" | "moment", targetIds: number[]): Map<number, number> {
  const ids = [...new Set(targetIds.filter((id) => Number.isInteger(id) && id > 0))];
  const result = new Map<number, number>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(
      `SELECT target_id, COUNT(*) AS c FROM comments WHERE target_type = ? AND status = 'approved' AND target_id IN (${placeholders}) GROUP BY target_id`,
    )
    .all(targetType, ...ids) as Array<{ target_id: number; c: number }>;
  for (const row of rows) result.set(row.target_id, row.c);
  return result;
}

export function createComment(data: {
  target_type: "post" | "moment";
  target_id: number;
  nickname: string;
  email?: string | null;
  website?: string | null;
  content: string;
  ip: string;
}): Comment {
  const info = db
    .prepare(
      "INSERT INTO comments (target_type, target_id, nickname, email, website, content, ip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    )
    .run(data.target_type, data.target_id, data.nickname, data.email ?? null, data.website ?? null, data.content, hashIp(data.ip), now());
  return db.prepare("SELECT * FROM comments WHERE id = ?").get(Number(info.lastInsertRowid)) as Comment;
}

export function approveComment(id: number): void {
  db.prepare("UPDATE comments SET status = 'approved' WHERE id = ?").run(id);
}

export function hideComment(id: number): void {
  db.prepare("UPDATE comments SET status = 'pending' WHERE id = ?").run(id);
}

export function updateCommentReply(id: number, reply: string | null): void {
  db.prepare("UPDATE comments SET admin_reply = ?, replied_at = ? WHERE id = ?").run(
    reply,
    reply ? now() : null,
    id,
  );
}

export function getComment(id: number): Comment | undefined {
  return db.prepare("SELECT * FROM comments WHERE id = ?").get(id) as Comment | undefined;
}

export function deleteComment(id: number): void {
  db.prepare("DELETE FROM comments WHERE id = ?").run(id);
}

export function countPendingComments(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM comments WHERE status = 'pending'").get() as { c: number }).c;
}

/** 限频用：该 IP 最近一条评论距现在的毫秒数，无记录返回 null */
export function lastCommentAgeByIp(ip: string): number | null {
  const row = db
    .prepare("SELECT created_at FROM comments WHERE ip = ? ORDER BY created_at DESC LIMIT 1")
    .get(hashIp(ip)) as { created_at: string } | undefined;
  if (!row) return null;
  return Date.now() - new Date(row.created_at).getTime();
}

export function commentTargetExists(targetType: "post" | "moment", targetId: number): boolean {
  // 草稿文章不接受评论，否则评论区永远不可见还会积累垃圾数据
  if (targetType === "post") {
    return !!db.prepare("SELECT id FROM posts WHERE id = ? AND status = 'published'").get(targetId);
  }
  return !!db.prepare("SELECT id FROM moments WHERE id = ?").get(targetId);
}

// ---------- sessions ----------

export function createSession(token: string, expiresAt: number): void {
  db.prepare("INSERT INTO sessions (id, created_at, expires_at) VALUES (?, ?, ?)").run(token, now(), expiresAt);
}

export function getSessionByToken(token: string): Session | undefined {
  return db.prepare("SELECT * FROM sessions WHERE id = ?").get(token) as Session | undefined;
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(token);
}

export function deleteExpiredSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(Date.now());
}

// ---------- login protection ----------

// login_attempts 只保存来源地址的 sha256 哈希（与 comments 一致），
// 避免明文留存客户端 IP；限流判定依赖哈希确定性，行为不变。
export function getLoginAttempt(key: string): LoginAttempt | undefined {
  return db.prepare("SELECT * FROM login_attempts WHERE ip = ?").get(hashIp(key)) as LoginAttempt | undefined;
}

export function recordLoginFailure(
  key: string,
  options: { now: number; windowMs: number; maxAttempts: number; blockMs: number },
): { failedCount: number; blockedUntil: number } {
  const hashedKey = hashIp(key);
  const existing = getLoginAttempt(key);
  if (!existing || options.now - existing.first_failed_at >= options.windowMs) {
    db.prepare(
      `INSERT INTO login_attempts (ip, failed_count, first_failed_at, blocked_until)
       VALUES (?, 1, ?, 0)
       ON CONFLICT(ip) DO UPDATE SET failed_count = 1, first_failed_at = excluded.first_failed_at, blocked_until = 0`,
    ).run(hashedKey, options.now);
    return { failedCount: 1, blockedUntil: 0 };
  }

  const failedCount = existing.failed_count + 1;
  const blockedUntil = failedCount >= options.maxAttempts ? options.now + options.blockMs : existing.blocked_until;
  db.prepare("UPDATE login_attempts SET failed_count = ?, blocked_until = ? WHERE ip = ?").run(
    failedCount,
    blockedUntil,
    hashedKey,
  );
  return { failedCount, blockedUntil };
}

export function clearLoginAttempt(key: string): void {
  db.prepare("DELETE FROM login_attempts WHERE ip = ?").run(hashIp(key));
}
