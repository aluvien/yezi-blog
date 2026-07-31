import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { normalizePostTags, parsePostTags } from "@/lib/post-tags";

export { normalizePostTags, parsePostTags } from "@/lib/post-tags";

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
      ensureColumn("posts", "tags", "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn("moments", "updated_at", "TEXT");
      ensureColumn("comments", "admin_reply", "TEXT");
      ensureColumn("comments", "replied_at", "TEXT");
      db.prepare("UPDATE moments SET updated_at = created_at WHERE updated_at IS NULL").run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_posts_status_time ON posts (status, created_at DESC)");
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

export interface AttachmentWithUsage extends Attachment {
  post_title: string | null;
  post_slug: string | null;
  referenced: boolean;
}

export interface Session {
  id: string;
  created_at: string;
  expires_at: number;
}

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

export function listPosts(): Post[] {
  return db.prepare("SELECT * FROM posts WHERE status = 'published' ORDER BY created_at DESC").all() as Post[];
}

export function listPostsByTag(tag: string): Post[] {
  const needle = tag.trim().toLocaleLowerCase();
  if (!needle) return [];
  return listPosts().filter((post) => parsePostTags(post.tags).some((item) => item.toLocaleLowerCase() === needle));
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
  tags?: string[];
  status?: "draft" | "published";
}): Post {
  const slug = ensureUniqueSlug(data.slug ?? "", data.title);
  const ts = now();
  const info = db
    .prepare("INSERT INTO posts (title, slug, content, cover, tags, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(data.title, slug, data.content, data.cover ?? null, JSON.stringify(normalizePostTags(data.tags)), ts, ts, data.status ?? "published");
  return getPost(Number(info.lastInsertRowid))!;
}

export function updatePost(
  id: number,
  data: {
    title: string;
    slug?: string;
    content: string;
    cover?: string | null;
    tags?: string[];
    status?: "draft" | "published";
  },
): Post | undefined {
  const slug = ensureUniqueSlug(data.slug ?? "", data.title, id);
  db.prepare("UPDATE posts SET title = ?, slug = ?, content = ?, cover = ?, tags = ?, status = ?, updated_at = ? WHERE id = ?").run(
    data.title,
    slug,
    data.content,
    data.cover ?? null,
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
  const rows = db
    .prepare(
      `SELECT a.*, p.title AS post_title, p.slug AS post_slug, p.content AS post_content
       FROM attachments a
       LEFT JOIN posts p ON p.id = a.post_id
       ORDER BY a.created_at DESC`,
    )
    .all() as Array<Attachment & { post_title: string | null; post_slug: string | null; post_content: string | null }>;
  return rows.map((row) => ({
    id: row.id,
    post_id: row.post_id,
    path: row.path,
    original_name: row.original_name,
    mime_type: row.mime_type,
    size: row.size,
    created_at: row.created_at,
    post_title: row.post_title,
    post_slug: row.post_slug,
    referenced: Boolean(row.post_content?.includes(row.path)),
  }));
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

/** 获取相关文章（排除当前文章，按时间倒序，最多 limit 篇） */
export function listRelatedPosts(currentId: number, limit = 3): Post[] {
  return db
    .prepare("SELECT * FROM posts WHERE id != ? AND status = 'published' ORDER BY created_at DESC LIMIT ?")
    .all(currentId, limit) as Post[];
}

// ---------- moments ----------

export function parseMomentImages(moment: Moment): string[] {
  try {
    const arr = JSON.parse(moment.images);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function listMoments(): Moment[] {
  return db.prepare("SELECT * FROM moments ORDER BY created_at DESC").all() as Moment[];
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
  db.prepare("DELETE FROM moments WHERE id = ?").run(id);
}

export function countMoments(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM moments").get() as { c: number }).c;
}

// ---------- works ----------

export function listWorks(): Work[] {
  return db.prepare("SELECT * FROM works ORDER BY sort_order ASC, created_at DESC").all() as Work[];
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

export function createComment(data: {
  target_type: "post" | "moment";
  target_id: number;
  nickname: string;
  email?: string | null;
  content: string;
  ip: string;
}): Comment {
  const info = db
    .prepare(
      "INSERT INTO comments (target_type, target_id, nickname, email, content, ip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)",
    )
    .run(data.target_type, data.target_id, data.nickname, data.email ?? null, data.content, data.ip, now());
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
    .get(ip) as { created_at: string } | undefined;
  if (!row) return null;
  return Date.now() - new Date(row.created_at).getTime();
}

export function commentTargetExists(targetType: "post" | "moment", targetId: number): boolean {
  const table = targetType === "post" ? "posts" : "moments";
  return !!db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(targetId);
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
