// 当前数据库的基础表结构。FTS 表及其触发器独立维护，见 fts.ts；这样迁移和
// 搜索索引的生命周期不会彼此耦合。
export const BASE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    cover TEXT,
    category TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published'))
  );
  CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    normalized_tag TEXT NOT NULL,
    PRIMARY KEY (post_id, normalized_tag),
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
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
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    images TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT
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
    created_at TEXT NOT NULL,
    admin_reply TEXT,
    replied_at TEXT
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
  CREATE TABLE IF NOT EXISTS qq_music_metadata (
    mid TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    artist TEXT NOT NULL DEFAULT '',
    cover TEXT NOT NULL DEFAULT '',
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
`;

// 旧库在补齐列之前不能建依赖新列的索引，所以索引作为迁移 v2 的最后一步单独执行。
export const INDEX_SCHEMA_SQL = `
  CREATE INDEX IF NOT EXISTS idx_article_reference_archive_jobs_state_time
    ON article_reference_archive_jobs (state, updated_at ASC);
  CREATE INDEX IF NOT EXISTS idx_article_reference_archive_jobs_url
    ON article_reference_archive_jobs (url, updated_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_article_reference_archive_jobs_active_url
    ON article_reference_archive_jobs (url)
    WHERE state IN ('queued', 'running');
  CREATE INDEX IF NOT EXISTS idx_comments_target ON comments (target_type, target_id, status);
  CREATE INDEX IF NOT EXISTS idx_comments_target_time ON comments (target_type, target_id, status, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_comments_ip_time ON comments (ip, created_at);
  CREATE INDEX IF NOT EXISTS idx_attachments_post ON attachments (post_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_article_references_post ON article_references (post_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_article_reference_archives_updated ON article_reference_archives (updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_reference_library_updated ON reference_library (updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);
  CREATE INDEX IF NOT EXISTS idx_content_interactions_time ON content_interactions (created_at);
  CREATE INDEX IF NOT EXISTS idx_posts_status_time ON posts (status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_reference_library_category ON reference_library (category COLLATE NOCASE);
`;
