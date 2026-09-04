import type Database from "better-sqlite3";
import { hashIp } from "@/lib/ip-hash";
import { parsePostTags } from "@/lib/post-tags";
import { BASE_SCHEMA_SQL, INDEX_SCHEMA_SQL } from "./schema";

export type Migration = {
  version: number;
  name: string;
  up: (db: Database.Database) => void;
};

function ensureColumn(db: Database.Database, table: string, column: string, definition: string): void {
  const columns = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: "base-schema",
    up(db) {
      db.exec(BASE_SCHEMA_SQL);
    },
  },
  {
    // 兼容正式版本号出现前已运行的旧库：CREATE TABLE IF NOT EXISTS 不会补列，
    // 所有历史增量必须在这里显式处理。
    version: 2,
    name: "legacy-columns-and-indexes",
    up(db) {
      ensureColumn(db, "posts", "status", "TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published'))");
      ensureColumn(db, "posts", "category", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "posts", "tags", "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn(db, "moments", "updated_at", "TEXT");
      ensureColumn(db, "comments", "admin_reply", "TEXT");
      ensureColumn(db, "comments", "replied_at", "TEXT");
      ensureColumn(db, "comments", "website", "TEXT");
      ensureColumn(db, "comments", "ip_address", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "article_reference_archives", "summary", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "article_reference_archives", "key_points", "TEXT NOT NULL DEFAULT '[]'");
      ensureColumn(db, "article_reference_archives", "ai_cleaned_at", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "article_reference_archives", "reader_markdown", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "article_reference_archives", "cache_report", "TEXT NOT NULL DEFAULT '{}'");
      ensureColumn(db, "reference_library", "category", "TEXT NOT NULL DEFAULT ''");
      db.exec(INDEX_SCHEMA_SQL);
    },
  },
  {
    version: 3,
    name: "legacy-data-repair",
    up(db) {
      db.prepare("UPDATE moments SET updated_at = created_at WHERE updated_at IS NULL").run();
      db.exec(`
        INSERT OR IGNORE INTO reference_library
          (url, canonical_url, title, source_name, author, published_at, cover, description, summary, key_points, created_at, updated_at)
        SELECT url, canonical_url, title, source_name, author, published_at, cover, description, summary, key_points, created_at, updated_at
        FROM article_references
      `);
      db.prepare("DELETE FROM site_settings WHERE key = 'meting_api'").run();

      const staleIps = db
        .prepare("SELECT id, ip FROM comments WHERE ip != '' AND length(ip) != 64")
        .all() as Array<{ id: number; ip: string }>;
      const updateIp = db.prepare("UPDATE comments SET ip = ? WHERE id = ?");
      for (const row of staleIps) {
        if (!/^[0-9a-f]{64}$/.test(row.ip)) updateIp.run(hashIp(row.ip), row.id);
      }
    },
  },
  {
    version: 4,
    name: "post-tag-relations",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS post_tags (
          post_id INTEGER NOT NULL,
          tag TEXT NOT NULL,
          normalized_tag TEXT NOT NULL,
          PRIMARY KEY (post_id, normalized_tag),
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_post_tags_normalized_tag ON post_tags (normalized_tag);
        CREATE INDEX IF NOT EXISTS idx_post_tags_post_id ON post_tags (post_id);
      `);
      const posts = db.prepare("SELECT id, tags FROM posts").all() as Array<{ id: number; tags: string }>;
      const clear = db.prepare("DELETE FROM post_tags WHERE post_id = ?");
      const insert = db.prepare("INSERT OR IGNORE INTO post_tags (post_id, tag, normalized_tag) VALUES (?, ?, ?)");
      for (const post of posts) {
        clear.run(post.id);
        for (const tag of parsePostTags(post.tags)) {
          insert.run(post.id, tag, tag.toLocaleLowerCase());
        }
      }
    },
  },
  {
    // ip_address 是历史后台展示字段；不再保留可识别的明文 IP，仍使用同一个
    // 不可逆摘要供管理员在多条评论间识别同一来源。
    version: 5,
    name: "hash-legacy-comment-ip-addresses",
    up(db) {
      const rows = db.prepare("SELECT id, ip, ip_address FROM comments WHERE ip_address != ''").all() as Array<{ id: number; ip: string; ip_address: string }>;
      const update = db.prepare("UPDATE comments SET ip_address = ? WHERE id = ?");
      for (const row of rows) {
        const hash = /^[0-9a-f]{64}$/.test(row.ip) ? row.ip : hashIp(row.ip || row.ip_address);
        update.run(hash, row.id);
      }
    },
  },
  {
    // 执行计划基线证明：原有标签 JOIN 会先扫描已发布文章，分类条件也没有
    // 覆盖 status + category + 时间排序。两个索引只改变查询代价，不改变数据或 API。
    version: 6,
    name: "query-plan-indexes",
    up(db) {
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_post_tags_normalized_tag_post_id
          ON post_tags (normalized_tag, post_id);
        CREATE INDEX IF NOT EXISTS idx_posts_status_category_time
          ON posts (status, category COLLATE NOCASE, created_at DESC);
      `);
    },
  },
  {
    // 引用库标签独立于文章标签，避免站外收藏误混入文章标签页；统一复用文章
    // 标签的解析规则，确保历史异常值也会升级为安全、可预测的 JSON 数组。
    version: 7,
    name: "reference-library-tags",
    up(db) {
      ensureColumn(db, "reference_library", "tags", "TEXT NOT NULL DEFAULT '[]'");
      const rows = db.prepare("SELECT id, tags FROM reference_library").all() as Array<{ id: number; tags: string }>;
      const update = db.prepare("UPDATE reference_library SET tags = ? WHERE id = ?");
      for (const row of rows) {
        const normalized = JSON.stringify(parsePostTags(row.tags));
        if (normalized !== row.tags) update.run(normalized, row.id);
      }
    },
  },
  {
    // 会话代际用于一次性撤销全部设备。管理员密码仍由环境变量提供；改密流程
    // 必须同时递增 generation，避免旧 Cookie 在密码轮换后继续有效。
    version: 8,
    name: "session-generation",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        );
      `);
      ensureColumn(db, "sessions", "generation", "INTEGER NOT NULL DEFAULT 1");
      db.exec(`
        CREATE TABLE IF NOT EXISTS auth_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          session_generation INTEGER NOT NULL DEFAULT 1 CHECK (session_generation > 0),
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS maintenance_leases (
          name TEXT PRIMARY KEY,
          last_run_at INTEGER NOT NULL
        );
      `);
      db.prepare(`
        INSERT OR IGNORE INTO auth_state (singleton, session_generation, updated_at)
        VALUES (1, 1, ?)
      `).run(new Date().toISOString());
    },
  },
  {
    version: 9,
    name: "moment-tags",
    up(db) {
      // Some upgrade-only fixtures contain just the table under test; do not
      // make an unrelated missing table a migration failure.
      const momentsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'moments'").get();
      if (momentsTable) ensureColumn(db, "moments", "tags", "TEXT NOT NULL DEFAULT '[]'");
    },
  },
  {
    // QQ 歌曲名、歌手和封面是稳定展示数据；持久化它们可让页面首屏不必反复
    // 请求 QQ 音乐。播放 URL 与登录态仍不落库，始终在用户主动播放时获取。
    version: 10,
    name: "qq-music-metadata-cache",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS qq_music_metadata (
          mid TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          artist TEXT NOT NULL DEFAULT '',
          cover TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
      `);
    },
  },
  {
    // 歌单展示必须同时保存曲目顺序和总数，才能在刷新页面时只读本站数据库，
    // 不因渲染卡片而再次请求 QQ。播放 URL 和登录态依然不会进入这些表。
    version: 11,
    name: "qq-music-playlist-metadata-cache",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS qq_music_playlists (
          playlist_id TEXT PRIMARY KEY,
          total INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS qq_music_playlist_tracks (
          playlist_id TEXT NOT NULL,
          position INTEGER NOT NULL,
          mid TEXT NOT NULL,
          PRIMARY KEY (playlist_id, position),
          FOREIGN KEY (playlist_id) REFERENCES qq_music_playlists(playlist_id) ON DELETE CASCADE,
          FOREIGN KEY (mid) REFERENCES qq_music_metadata(mid) ON DELETE RESTRICT
        );
        CREATE INDEX IF NOT EXISTS idx_qq_music_playlist_tracks_mid
          ON qq_music_playlist_tracks (mid);
      `);
    },
  },
  {
    // 想法仅保留手动填写或定位反查得到的城市文字；不存储精确坐标，避免
    // 将发布时的敏感定位信息写入数据库或公开 API。
    version: 12,
    name: "moment-location",
    up(db) {
      const momentsTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'moments'").get();
      if (momentsTable) ensureColumn(db, "moments", "location", "TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    // 管理员密码版本指纹：改密后启动时自动撤销全部旧会话，被盗 Cookie 不再
    // 依赖“记得手动跑 revoke-all”。只存随机盐 + scrypt 派生值，不存密码本身。
    version: 13,
    name: "admin-password-fingerprint",
    up(db) {
      const authState = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'auth_state'").get();
      if (authState) ensureColumn(db, "auth_state", "password_fingerprint", "TEXT");
    },
  },
  {
    // 小记系统升级：独立的生活节点、GitHub 仓库登记与作品关联、以及资料间的
    // 宽泛关联。表结构已在 BASE_SCHEMA_SQL 中定义（供全新库使用），这里用
    // IF NOT EXISTS 让历史库补齐同样的结构，二者语义一致、可重复执行。
    version: 14,
    name: "life-milestones-github-and-relations",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS life_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL DEFAULT '',
          content TEXT NOT NULL DEFAULT '',
          occurred_at TEXT NOT NULL,
          date_precision TEXT NOT NULL DEFAULT 'day' CHECK (date_precision IN ('day','month','year')),
          cover TEXT,
          images TEXT NOT NULL DEFAULT '[]',
          tags TEXT NOT NULL DEFAULT '[]',
          location TEXT NOT NULL DEFAULT '',
          source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual','moment')),
          source_moment_id INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (source_moment_id) REFERENCES moments(id) ON DELETE SET NULL
        );
        CREATE TABLE IF NOT EXISTS github_repositories (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          owner TEXT NOT NULL,
          name TEXT NOT NULL,
          full_name TEXT NOT NULL UNIQUE,
          repo_url TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          homepage TEXT NOT NULL DEFAULT '',
          primary_language TEXT NOT NULL DEFAULT '',
          topics TEXT NOT NULL DEFAULT '[]',
          stars INTEGER NOT NULL DEFAULT 0,
          forks INTEGER NOT NULL DEFAULT 0,
          license TEXT NOT NULL DEFAULT '',
          default_branch TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0,
          visibility TEXT NOT NULL DEFAULT 'public',
          github_created_at TEXT NOT NULL DEFAULT '',
          github_updated_at TEXT NOT NULL DEFAULT '',
          pushed_at TEXT NOT NULL DEFAULT '',
          custom_title TEXT NOT NULL DEFAULT '',
          custom_description TEXT NOT NULL DEFAULT '',
          cover TEXT,
          tags TEXT NOT NULL DEFAULT '[]',
          featured INTEGER NOT NULL DEFAULT 0,
          registered_at TEXT NOT NULL,
          synced_at TEXT,
          sync_status TEXT NOT NULL DEFAULT 'idle' CHECK (sync_status IN ('idle','success','error')),
          sync_error TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS work_github_repositories (
          work_id INTEGER NOT NULL,
          repository_id INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (work_id, repository_id),
          FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE,
          FOREIGN KEY (repository_id) REFERENCES github_repositories(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS reference_relations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          reference_id INTEGER NOT NULL,
          target_type TEXT NOT NULL CHECK (target_type IN ('post','life_event','work','github_repository')),
          target_id INTEGER NOT NULL,
          context TEXT NOT NULL DEFAULT '',
          created_at TEXT NOT NULL,
          UNIQUE(reference_id, target_type, target_id),
          FOREIGN KEY (reference_id) REFERENCES reference_library(id) ON DELETE CASCADE
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_life_events_source_moment
          ON life_events (source_moment_id) WHERE source_moment_id IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_life_events_occurred ON life_events (occurred_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_github_repositories_registered ON github_repositories (registered_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_reference_relations_reference ON reference_relations (reference_id);
        CREATE INDEX IF NOT EXISTS idx_reference_relations_target ON reference_relations (target_type, target_id);
      `);
    },
  },
  {
    // 收藏引用增强：备注、流转状态、收藏标记，并把“收藏时间”与“发布时间”
    // 分开。saved_at 是本次新增的语义字段，历史数据回填为既有的 created_at，
    // 保证升级后小记时间流的排序稳定。
    version: 15,
    name: "reference-library-collection-metadata",
    up(db) {
      ensureColumn(db, "reference_library", "note", "TEXT NOT NULL DEFAULT ''");
      ensureColumn(db, "reference_library", "status", "TEXT NOT NULL DEFAULT 'inbox'");
      ensureColumn(db, "reference_library", "favorite", "INTEGER NOT NULL DEFAULT 0");
      ensureColumn(db, "reference_library", "saved_at", "TEXT");
      ensureColumn(db, "reference_library", "last_checked_at", "TEXT");
      const referenceTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'reference_library'").get();
      if (referenceTable) db.prepare("UPDATE reference_library SET saved_at = created_at WHERE saved_at IS NULL OR trim(saved_at) = ''").run();
      db.exec("CREATE INDEX IF NOT EXISTS idx_reference_library_saved ON reference_library (saved_at DESC, id DESC)");
    },
  },
  {
    // 文章阅读模式分享使用稳定的八位短码；短码与文章解耦保存，文章改名或
    // slug 调整后，已经分享出去的地址仍然可以正常跳转。
    version: 16,
    name: "post-short-links",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS post_short_links (
          code TEXT PRIMARY KEY,
          post_id INTEGER NOT NULL UNIQUE,
          created_at TEXT NOT NULL,
          FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_post_short_links_post ON post_short_links (post_id);
      `);
    },
  },
];

export const LATEST_DB_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? 0;

function readUserVersion(db: Database.Database): number {
  const row = db.pragma("user_version", { simple: true });
  return typeof row === "number" ? row : 0;
}

function assertMigrationSequence(migrations: readonly Migration[]): void {
  let previous = 0;
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version !== previous + 1) {
      throw new Error("数据库迁移版本必须从 1 开始连续递增");
    }
    previous = migration.version;
  }
}

/**
 * 每个版本在独立 SQLite transaction 中完成，并在同一 transaction 写入
 * PRAGMA user_version；迁移失败时 DDL、数据修复与版本号会一起回滚。
 */
export function runMigrations(db: Database.Database, migrations: readonly Migration[] = MIGRATIONS): number {
  assertMigrationSequence(migrations);
  let current = readUserVersion(db);
  const supported = migrations.at(-1)?.version ?? 0;
  if (current > supported) {
    throw new Error(`数据库 schema v${current} 高于当前代码支持的 v${supported}，已拒绝启动以避免旧代码写入未来结构`);
  }
  for (const migration of migrations) {
    if (migration.version <= current) continue;
    const apply = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
    current = migration.version;
  }
  return current;
}
