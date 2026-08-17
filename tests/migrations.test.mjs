import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import Database from "better-sqlite3";

const { runMigrations, LATEST_DB_SCHEMA_VERSION } = await import("../src/lib/db/migrations.ts");
const { ensureFtsIndexes } = await import("../src/lib/db/fts.ts");

function createTemporaryDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-migrations-"));
  return { dir, db: new Database(path.join(dir, "blog.db")) };
}

function closeTemporaryDatabase({ dir, db }) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

test("empty database creates the latest schema and a working FTS index", () => {
  const temporary = createTemporaryDatabase();
  try {
    assert.equal(runMigrations(temporary.db), LATEST_DB_SCHEMA_VERSION);
    assert.equal(temporary.db.pragma("user_version", { simple: true }), LATEST_DB_SCHEMA_VERSION);
    assert.ok(temporary.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'posts'").get());
    assert.ok(temporary.db.prepare("SELECT 1 FROM pragma_table_info('posts') WHERE name = 'status'").get());
    assert.ok(temporary.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_posts_status_time'").get());

    ensureFtsIndexes(temporary.db);
    temporary.db.prepare("INSERT INTO posts (title, slug, content, category, tags, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "migration search",
      "migration-search",
      "working fts token",
      "test",
      "[]",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      "published",
    );
    assert.equal(temporary.db.prepare("SELECT count(*) AS count FROM fts_posts WHERE fts_posts MATCH ?").get('"fts"').count, 1);
  } finally {
    closeTemporaryDatabase(temporary);
  }
});

test("legacy schema upgrades without losing rows and is idempotent", () => {
  const temporary = createTemporaryDatabase();
  try {
    temporary.db.exec(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL DEFAULT '',
        cover TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE moments (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, images TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL);
      CREATE TABLE comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_type TEXT NOT NULL,
        target_id INTEGER NOT NULL,
        nickname TEXT NOT NULL,
        email TEXT,
        content TEXT NOT NULL,
        ip TEXT NOT NULL DEFAULT '',
        ip_address TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL
      );
    `);
    temporary.db.prepare("INSERT INTO posts (title, slug, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
      "legacy title",
      "legacy-title",
      "legacy content",
      '["Legacy Tag"]',
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );
    temporary.db.prepare("INSERT INTO moments (content, images, created_at) VALUES (?, ?, ?)").run("legacy moment", "[]", "2026-01-01T00:00:00.000Z");
    temporary.db.prepare("INSERT INTO comments (target_type, target_id, nickname, content, ip, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      "post",
      1,
      "legacy",
      "comment",
      "127.0.0.1",
      "127.0.0.1",
      "2026-01-01T00:00:00.000Z",
    );

    runMigrations(temporary.db);
    const post = temporary.db.prepare("SELECT title, status, category, tags FROM posts WHERE id = 1").get();
    assert.deepEqual(post, { title: "legacy title", status: "published", category: "", tags: '["Legacy Tag"]' });
    assert.deepEqual(
      temporary.db.prepare("SELECT post_id, tag, normalized_tag FROM post_tags").all(),
      [{ post_id: 1, tag: "Legacy Tag", normalized_tag: "legacy tag" }],
    );
    assert.equal(temporary.db.prepare("SELECT updated_at FROM moments WHERE id = 1").get().updated_at, "2026-01-01T00:00:00.000Z");
    assert.match(temporary.db.prepare("SELECT ip FROM comments WHERE id = 1").get().ip, /^[0-9a-f]{64}$/);
    assert.match(temporary.db.prepare("SELECT ip_address FROM comments WHERE id = 1").get().ip_address, /^[0-9a-f]{64}$/);
    assert.equal(runMigrations(temporary.db), LATEST_DB_SCHEMA_VERSION);
    assert.equal(temporary.db.prepare("SELECT count(*) AS count FROM posts").get().count, 1);
    ensureFtsIndexes(temporary.db);
    assert.equal(temporary.db.prepare("SELECT count(*) AS count FROM fts_posts").get().count, 1);
  } finally {
    closeTemporaryDatabase(temporary);
  }
});

test("a failed migration rolls back its schema work and does not advance its version", () => {
  const temporary = createTemporaryDatabase();
  try {
    const migrations = [
      { version: 1, name: "stable", up(db) { db.exec("CREATE TABLE stable_table (id INTEGER PRIMARY KEY)"); } },
      { version: 2, name: "broken", up(db) { db.exec("CREATE TABLE should_rollback (id INTEGER PRIMARY KEY)"); throw new Error("intentional migration failure"); } },
    ];
    assert.throws(() => runMigrations(temporary.db, migrations), /intentional migration failure/);
    assert.equal(temporary.db.pragma("user_version", { simple: true }), 1);
    assert.ok(temporary.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'stable_table'").get());
    assert.equal(temporary.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'should_rollback'").get(), undefined);
  } finally {
    closeTemporaryDatabase(temporary);
  }
});

test("reference library tag migration adds an empty JSON tag list without losing existing metadata", () => {
  const temporary = createTemporaryDatabase();
  try {
    temporary.db.exec(`
      CREATE TABLE reference_library (
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
      PRAGMA user_version = 6;
    `);
    temporary.db.prepare(`
      INSERT INTO reference_library
        (url, canonical_url, title, category, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "https://example.com/legacy-reference",
      "https://example.com/legacy-reference",
      "旧引用",
      "技术",
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    );

    assert.equal(runMigrations(temporary.db), LATEST_DB_SCHEMA_VERSION);
    assert.deepEqual(
      temporary.db.prepare("SELECT title, category, tags FROM reference_library").get(),
      { title: "旧引用", category: "技术", tags: "[]" },
    );
    assert.equal(runMigrations(temporary.db), LATEST_DB_SCHEMA_VERSION);
  } finally {
    closeTemporaryDatabase(temporary);
  }
});
