// 数据库连接单例。结构升级见 migrations.ts，FTS 一致性见 fts.ts；DAO 子模块只依赖本文件。
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "@/lib/uploads";
import { ensureFtsIndexes } from "./fts";
import { runMigrations } from "./migrations";

const defaultDataDir = path.join(getProjectRoot(), "data");
const configuredDbPath = process.env.BLOG_DB_PATH?.trim();
const DB_PATH = configuredDbPath ? path.resolve(configuredDbPath) : path.join(defaultDataDir, "blog.db");
const DB_DIR = path.dirname(DB_PATH);
// An arbitrary external BLOG_DB_PATH may share its directory with another
// service, so only change directory permissions for this application's data.
const managesDatabaseDirectory = DB_DIR === defaultDataDir;

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function configureConnection(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");
}

/** SQLite sidecars can be recreated after a checkpoint; secure every one seen at startup. */
function secureDatabaseFiles(): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    const file = `${DB_PATH}${suffix}`;
    if (fs.existsSync(file)) fs.chmodSync(file, 0o600);
  }
}

function createDb(): Database.Database {
  if (process.env.BLOG_BUILD_READONLY === "true") {
    const readonlyDb = new Database(DB_PATH, { readonly: true, fileMustExist: true, timeout: 5000 });
    readonlyDb.pragma("busy_timeout = 5000");
    readonlyDb.pragma("foreign_keys = ON");
    return readonlyDb;
  }

  fs.mkdirSync(DB_DIR, { recursive: true, mode: 0o700 });
  if (managesDatabaseDirectory) fs.chmodSync(DB_DIR, 0o700);
  // build 期多个 worker 可能同时首次打开数据库；迁移和 FTS 重建都是事务化的，
  // 锁竞争时关闭本次连接并重试，避免把半完成的连接留在进程内。
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let database: Database.Database | undefined;
    try {
      database = new Database(DB_PATH, { timeout: 5000 });
      configureConnection(database);
      runMigrations(database);
      ensureFtsIndexes(database);
      secureDatabaseFiles();
      return database;
    } catch (error) {
      lastError = error;
      database?.close();
      sleepSync(150);
    }
  }
  throw lastError;
}

// 开发模式 HMR 会重复加载模块，用 globalThis 缓存避免重复连接。
const globalForDb = globalThis as unknown as { __blogDb?: Database.Database };
export const db: Database.Database = globalForDb.__blogDb ?? (globalForDb.__blogDb = createDb());

/** 统一时间戳：ISO 字符串。 */
export function now(): string {
  return new Date().toISOString();
}
