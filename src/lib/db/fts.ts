import crypto from "node:crypto";
import type Database from "better-sqlite3";

// 修改分词器、payload 组成或触发器语义时必须递增；旧库会在下一次可写启动时
// 原子重建一次，之后只做轻量一致性验证。
export const FTS_SCHEMA_VERSION = 1;

const FTS_DDL = `
  CREATE VIRTUAL TABLE fts_posts USING fts5(payload, tokenize = 'trigram');
  CREATE VIRTUAL TABLE fts_moments USING fts5(payload, tokenize = 'trigram');
  CREATE TRIGGER fts_posts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO fts_posts(rowid, payload) VALUES (new.id, new.title || char(10) || new.content || char(10) || new.category || char(10) || new.tags);
  END;
  CREATE TRIGGER fts_posts_ad AFTER DELETE ON posts BEGIN
    DELETE FROM fts_posts WHERE rowid = old.id;
  END;
  CREATE TRIGGER fts_posts_au AFTER UPDATE ON posts BEGIN
    DELETE FROM fts_posts WHERE rowid = old.id;
    INSERT INTO fts_posts(rowid, payload) VALUES (new.id, new.title || char(10) || new.content || char(10) || new.category || char(10) || new.tags);
  END;
  CREATE TRIGGER fts_moments_ai AFTER INSERT ON moments BEGIN
    INSERT INTO fts_moments(rowid, payload) VALUES (new.id, new.content);
  END;
  CREATE TRIGGER fts_moments_ad AFTER DELETE ON moments BEGIN
    DELETE FROM fts_moments WHERE rowid = old.id;
  END;
  CREATE TRIGGER fts_moments_au AFTER UPDATE ON moments BEGIN
    DELETE FROM fts_moments WHERE rowid = old.id;
    INSERT INTO fts_moments(rowid, payload) VALUES (new.id, new.content);
  END;
`;

const FTS_TRIGGER_NAMES = ["fts_posts_ai", "fts_posts_ad", "fts_posts_au", "fts_moments_ai", "fts_moments_ad", "fts_moments_au"] as const;
const FTS_VERSION_SETTING = "fts_schema_version";
const FTS_TRIGGER_SIGNATURES: Record<(typeof FTS_TRIGGER_NAMES)[number], readonly string[]> = {
  fts_posts_ai: ["afterinsertonposts", "insertintofts_posts(rowid,payload)values(new.id"],
  fts_posts_ad: ["afterdeleteonposts", "deletefromfts_postswhererowid=old.id"],
  fts_posts_au: ["afterupdateonposts", "deletefromfts_postswhererowid=old.id", "insertintofts_posts(rowid,payload)values(new.id"],
  fts_moments_ai: ["afterinsertonmoments", "insertintofts_moments(rowid,payload)values(new.id"],
  fts_moments_ad: ["afterdeleteonmoments", "deletefromfts_momentswhererowid=old.id"],
  fts_moments_au: ["afterupdateonmoments", "deletefromfts_momentswhererowid=old.id", "insertintofts_moments(rowid,payload)values(new.id"],
};

type FtsKind = "posts" | "moments";
type FtsStatus = { rebuilt: boolean; reason: string | null };

function tableExists(db: Database.Database, table: string): boolean {
  const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | undefined;
  return !!row && row.sql.replace(/\s+/g, "").toLowerCase().includes("usingfts5(payload,tokenize='trigram')");
}

function allTriggersAreCurrent(db: Database.Database): boolean {
  const placeholders = FTS_TRIGGER_NAMES.map(() => "?").join(",");
  const rows = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name IN (${placeholders})`).all(...FTS_TRIGGER_NAMES) as Array<{ name: string; sql: string }>;
  if (rows.length !== FTS_TRIGGER_NAMES.length) return false;
  return rows.every((row) => {
    const name = row.name as (typeof FTS_TRIGGER_NAMES)[number];
    const normalizedSql = row.sql.replace(/\s+/g, "").toLowerCase();
    return name in FTS_TRIGGER_SIGNATURES && FTS_TRIGGER_SIGNATURES[name].every((fragment) => normalizedSql.includes(fragment));
  });
}

function countRows(db: Database.Database, table: string): number {
  return (db.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count;
}

function payloadDigest(db: Database.Database, kind: FtsKind, source: boolean): string {
  const statement = kind === "posts"
    ? source
      ? db.prepare("SELECT id AS rowid, title || char(10) || content || char(10) || category || char(10) || tags AS payload FROM posts ORDER BY id")
      : db.prepare("SELECT rowid, payload FROM fts_posts ORDER BY rowid")
    : source
      ? db.prepare("SELECT id AS rowid, content AS payload FROM moments ORDER BY id")
      : db.prepare("SELECT rowid, payload FROM fts_moments ORDER BY rowid");
  const digest = crypto.createHash("sha256");
  for (const row of statement.iterate() as Iterable<{ rowid: number; payload: string }>) {
    digest.update(String(row.rowid));
    digest.update("\0");
    digest.update(row.payload);
    digest.update("\0");
  }
  return digest.digest("hex");
}

function getSetting(db: Database.Database, key: string): string | null {
  return (db.prepare("SELECT value FROM site_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value ?? null;
}

function setSetting(db: Database.Database, key: string, value: string): void {
  db.prepare(
    "INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
  ).run(key, value, new Date().toISOString());
}

function dropFtsObjects(db: Database.Database): void {
  for (const trigger of FTS_TRIGGER_NAMES) db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
  db.exec("DROP TABLE IF EXISTS fts_posts");
  db.exec("DROP TABLE IF EXISTS fts_moments");
}

function writeCurrentState(db: Database.Database): void {
  setSetting(db, FTS_VERSION_SETTING, String(FTS_SCHEMA_VERSION));
}

/** Force an atomic FTS rebuild. Exported for maintenance commands and integration tests. */
export function rebuildFtsIndexes(db: Database.Database, reason = "manual"): FtsStatus {
  const rebuild = db.transaction(() => {
    dropFtsObjects(db);
    db.exec(FTS_DDL);
    db.exec("INSERT INTO fts_posts (rowid, payload) SELECT id, title || char(10) || content || char(10) || category || char(10) || tags FROM posts");
    db.exec("INSERT INTO fts_moments (rowid, payload) SELECT id, content FROM moments");
    writeCurrentState(db);
  });
  rebuild();
  return { rebuilt: true, reason };
}

/**
 * FTS is not rebuilt unconditionally: a healthy index only performs ordered
 * source/index digest comparisons. They catch equal-count stale/corrupted payloads and manual SQL
 * edits that a count check cannot see; any detected mismatch rebuilds in one
 * transaction so searches never start with a partially rebuilt index.
 */
export function ensureFtsIndexes(db: Database.Database): FtsStatus {
  if (!tableExists(db, "fts_posts") || !tableExists(db, "fts_moments")) return rebuildFtsIndexes(db, "missing-table");
  if (!allTriggersAreCurrent(db)) return rebuildFtsIndexes(db, "missing-or-stale-trigger");
  if (getSetting(db, FTS_VERSION_SETTING) !== String(FTS_SCHEMA_VERSION)) return rebuildFtsIndexes(db, "schema-version");
  try {
    if (countRows(db, "posts") !== countRows(db, "fts_posts") || countRows(db, "moments") !== countRows(db, "fts_moments")) {
      return rebuildFtsIndexes(db, "count-mismatch");
    }
    const postsSourceDigest = payloadDigest(db, "posts", true);
    const momentsSourceDigest = payloadDigest(db, "moments", true);
    if (payloadDigest(db, "posts", false) !== postsSourceDigest || payloadDigest(db, "moments", false) !== momentsSourceDigest) {
      return rebuildFtsIndexes(db, "payload-mismatch");
    }
    return { rebuilt: false, reason: null };
  } catch {
    return rebuildFtsIndexes(db, "validation-error");
  }
}
