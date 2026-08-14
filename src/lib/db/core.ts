// 数据库连接单例 + schema/迁移 + FTS 同步。所有 DAO 子模块只依赖本文件。
import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { hashIp } from "@/lib/ip-hash";
import { getProjectRoot } from "@/lib/uploads";

const configuredDbPath = process.env.BLOG_DB_PATH?.trim();
const DB_PATH = configuredDbPath ? path.resolve(configuredDbPath) : path.join(getProjectRoot(), "data", "blog.db");
const DB_DIR = path.dirname(DB_PATH);

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// FTS5 全文索引 DDL，独立成常量供 createDb 建表和 syncFts 重建共用。
// trigram 按连续 3 字符建 token，支持任意 ≥3 字符子串匹配，与前台 includes 的子串
// 语义一致；<3 字符的查询在代码里回退全量扫描。用冗余 payload 列（不建 external
// content 表），触发器在增删改时同步。
const FTS_FULL_TEXT_DDL = `
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_posts USING fts5(payload, tokenize = 'trigram');
    CREATE VIRTUAL TABLE IF NOT EXISTS fts_moments USING fts5(payload, tokenize = 'trigram');

    CREATE TRIGGER IF NOT EXISTS fts_posts_ai AFTER INSERT ON posts BEGIN
      INSERT INTO fts_posts(rowid, payload) VALUES (new.id, new.title || char(10) || new.content || char(10) || new.category || char(10) || new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS fts_posts_ad AFTER DELETE ON posts BEGIN
      DELETE FROM fts_posts WHERE rowid = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS fts_posts_au AFTER UPDATE ON posts BEGIN
      DELETE FROM fts_posts WHERE rowid = old.id;
      INSERT INTO fts_posts(rowid, payload) VALUES (new.id, new.title || char(10) || new.content || char(10) || new.category || char(10) || new.tags);
    END;
    CREATE TRIGGER IF NOT EXISTS fts_moments_ai AFTER INSERT ON moments BEGIN
      INSERT INTO fts_moments(rowid, payload) VALUES (new.id, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS fts_moments_ad AFTER DELETE ON moments BEGIN
      DELETE FROM fts_moments WHERE rowid = old.id;
    END;
    CREATE TRIGGER IF NOT EXISTS fts_moments_au AFTER UPDATE ON moments BEGIN
      DELETE FROM fts_moments WHERE rowid = old.id;
      INSERT INTO fts_moments(rowid, payload) VALUES (new.id, new.content);
    END;
  `;

function createDb(): Database.Database {
  const buildReadonly = process.env.BLOG_BUILD_READONLY === "true";
  if (buildReadonly) {
    const readonlyDb = new Database(DB_PATH, { readonly: true, fileMustExist: true, timeout: 5000 });
    readonlyDb.pragma("busy_timeout = 5000");
    readonlyDb.pragma("foreign_keys = ON");
    return readonlyDb;
  }
  fs.mkdirSync(DB_DIR, { recursive: true });
  // build 期多个 worker 进程会同时加载本模块、并发建库建表，
  // busy_timeout 无法覆盖所有锁定路径（如 WAL 切换），失败时整体重试
  let lastErr: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const db = new Database(DB_PATH, { timeout: 5000 });
      db.pragma("journal_mode = WAL");
      db.pragma("synchronous = NORMAL");
      db.pragma("busy_timeout = 5000");
      db.pragma("foreign_keys = ON");
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
    CREATE TABLE IF NOT EXISTS article_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      post_id INTEGER NOT NULL,
      url TEXT NOT NULL,
      canonical_url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      key_points TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(post_id, canonical_url),
      FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS article_reference_archives (
      canonical_url TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      reader_html TEXT NOT NULL DEFAULT '',
      reader_markdown TEXT NOT NULL DEFAULT '',
      reader_text TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      key_points TEXT NOT NULL DEFAULT '[]',
      ai_cleaned_at TEXT NOT NULL DEFAULT '',
      raw_path TEXT NOT NULL DEFAULT '',
      content_hash TEXT NOT NULL DEFAULT '',
      cache_report TEXT NOT NULL DEFAULT '{}',
      captured_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS article_reference_archive_jobs (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('queued','running','completed','failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      result_json TEXT NOT NULL DEFAULT '',
      error TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_article_reference_archive_jobs_state_time
      ON article_reference_archive_jobs (state, updated_at ASC);
    CREATE INDEX IF NOT EXISTS idx_article_reference_archive_jobs_url
      ON article_reference_archive_jobs (url, updated_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_article_reference_archive_jobs_active_url
      ON article_reference_archive_jobs (url)
      WHERE state IN ('queued', 'running');
    -- 独立引用资料库：不再要求一条引用必须属于某篇本地文章。
    CREATE TABLE IF NOT EXISTS reference_library (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      url TEXT NOT NULL,
      canonical_url TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL DEFAULT '',
      author TEXT NOT NULL DEFAULT '',
      published_at TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      key_points TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT '',
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
      ip_address TEXT NOT NULL DEFAULT '',
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
    CREATE INDEX IF NOT EXISTS idx_comments_target_time ON comments (target_type, target_id, status, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_comments_ip_time ON comments (ip, created_at);
    CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments (post_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_references_post ON article_references (post_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_article_reference_archives_updated ON article_reference_archives (updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_reference_library_updated ON reference_library (updated_at DESC);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
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

    ${FTS_FULL_TEXT_DDL}
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
      ensureColumn("comments", "ip_address", "TEXT NOT NULL DEFAULT ''");
      ensureColumn("article_reference_archives", "summary", "TEXT NOT NULL DEFAULT ''");
      ensureColumn("article_reference_archives", "key_points", "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn("article_reference_archives", "ai_cleaned_at", "TEXT NOT NULL DEFAULT ''");
      ensureColumn("article_reference_archives", "reader_markdown", "TEXT NOT NULL DEFAULT ''");
      ensureColumn("article_reference_archives", "cache_report", "TEXT NOT NULL DEFAULT '{}'");
      ensureColumn("reference_library", "category", "TEXT NOT NULL DEFAULT ''");
      db.prepare("UPDATE moments SET updated_at = created_at WHERE updated_at IS NULL").run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_posts_status_time ON posts (status, created_at DESC)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category COLLATE NOCASE)");
      db.exec("CREATE INDEX IF NOT EXISTS idx_reference_library_category ON reference_library (category COLLATE NOCASE)");

      // 将旧版“文章内引用”迁入独立资料库。INSERT OR IGNORE 使迁移可重复执行，
      // 且不会覆盖后来单独更新过的库内信息。
      db.exec(`
        INSERT OR IGNORE INTO reference_library
          (url, canonical_url, title, source_name, author, published_at, cover, description, summary, key_points, created_at, updated_at)
        SELECT url, canonical_url, title, source_name, author, published_at, cover, description, summary, key_points, created_at, updated_at
        FROM article_references
      `);

      // QQ VIP 是唯一音乐源，清理已经废弃的旧音乐配置。
      db.prepare("DELETE FROM site_settings WHERE key = 'meting_api'").run();

      // 旧版本明文存储评论 IP，这里幂等迁移为 sha256 哈希（哈希固定 64 位 hex）。
      const staleIps = db
        .prepare("SELECT id, ip FROM comments WHERE ip != '' AND length(ip) != 64")
        .all() as Array<{ id: number; ip: string }>;
      const updateIp = db.prepare("UPDATE comments SET ip = ? WHERE id = ?");
      for (const row of staleIps) {
        if (row.ip && !/^[0-9a-f]{64}$/.test(row.ip)) updateIp.run(hashIp(row.ip), row.id);
      }

      // FTS 触发器定义随版本演进（例如删除实现从 FTS5 delete 命令改为按 rowid
      // 删除），这里每次启动都重建，保证已有库立即用上最新定义；触发器是轻量对象，
      // 开销可忽略。build 期只读库走 createDb 的 readonly 分支，不执行这里的写入。
      for (const prefix of ["fts_posts", "fts_moments"]) {
        for (const suffix of ["ai", "ad", "au"]) db.exec(`DROP TRIGGER IF EXISTS ${prefix}_${suffix}`);
      }
      db.exec(FTS_FULL_TEXT_DDL);

      // FTS 表数据由触发器维护；首次建表或与源表计数不一致时从源表重建。
      // 注意普通 FTS5 表的 rebuild 指令只重索引已有行、不会从源表读数据，因此用
      // INSERT SELECT 填充；表非空且计数不一致时，普通 FTS5 表不支持 delete-all /
      // 全表 DELETE，改为先删触发器再 DROP 表，用 FTS_FULL_TEXT_DDL 重建后再填充。
      const syncFts = (ftsTable: string, sourceCount: number, insertSql: string) => {
        const ftsCount = (db.prepare(`SELECT count(*) AS c FROM ${ftsTable}`).get() as { c: number }).c;
        if (ftsCount === sourceCount) return;
        if (ftsCount > 0) {
          for (const suffix of ["ai", "ad", "au"]) db.exec(`DROP TRIGGER IF EXISTS ${ftsTable}_${suffix}`);
          db.exec(`DROP TABLE IF EXISTS ${ftsTable}`);
          db.exec(FTS_FULL_TEXT_DDL);
        }
        db.exec(`INSERT INTO ${ftsTable} ${insertSql}`);
      };
      const postsCount = (db.prepare("SELECT count(*) AS c FROM posts").get() as { c: number }).c;
      const momentsCount = (db.prepare("SELECT count(*) AS c FROM moments").get() as { c: number }).c;
      try {
        syncFts("fts_posts", postsCount, `(rowid, payload) SELECT id, title || char(10) || content || char(10) || category || char(10) || tags FROM posts`);
        syncFts("fts_moments", momentsCount, `(rowid, payload) SELECT id, content FROM moments`);
      } catch (error) {
        // 重建失败不影响建库与启动，下次启动或数据写入会再次补齐。
        console.warn(`[db] FTS 索引重建失败：${error instanceof Error ? error.message : String(error)}`);
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

/** 统一时间戳：ISO 字符串。 */
export function now(): string {
  return new Date().toISOString();
}
