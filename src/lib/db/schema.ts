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
  CREATE TABLE IF NOT EXISTS post_short_links (
    code TEXT PRIMARY KEY,
    post_id INTEGER NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
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
    note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','read','archived')),
    favorite INTEGER NOT NULL DEFAULT 0,
    saved_at TEXT,
    last_checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
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
  CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    images TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    location TEXT NOT NULL DEFAULT '',
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
  CREATE INDEX IF NOT EXISTS idx_qq_music_playlist_tracks_mid
    ON qq_music_playlist_tracks (mid);
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
  CREATE INDEX IF NOT EXISTS idx_post_short_links_post ON post_short_links (post_id);
  CREATE INDEX IF NOT EXISTS idx_posts_category ON posts (category COLLATE NOCASE);
  CREATE INDEX IF NOT EXISTS idx_reference_library_category ON reference_library (category COLLATE NOCASE);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_life_events_source_moment
    ON life_events (source_moment_id) WHERE source_moment_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_life_events_occurred ON life_events (occurred_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_github_repositories_registered ON github_repositories (registered_at DESC, id DESC);
  CREATE INDEX IF NOT EXISTS idx_reference_relations_reference ON reference_relations (reference_id);
  CREATE INDEX IF NOT EXISTS idx_reference_relations_target ON reference_relations (target_type, target_id);
  CREATE INDEX IF NOT EXISTS idx_reference_library_saved ON reference_library (saved_at DESC, id DESC);
`;
