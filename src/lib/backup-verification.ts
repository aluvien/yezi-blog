import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type DatabaseBackupVerification = {
  path: string;
  sizeBytes: number;
  schemaVersion: number;
};

const REQUIRED_TABLES = ["posts", "moments", "site_settings"] as const;

/**
 * Open a backup as a brand-new readonly SQLite connection and run SQLite's
 * full integrity check. This is intentionally independent from the source
 * database connection: a successful online backup call alone is not proof
 * that the resulting artifact can later be opened for recovery.
 */
export function verifyDatabaseBackup(inputPath: string): DatabaseBackupVerification {
  const backupPath = path.resolve(inputPath);
  try {
    const stat = fs.statSync(backupPath);
    if (!stat.isFile() || stat.size <= 0) throw new Error("备份文件不存在或为空");

    const database = new Database(backupPath, { readonly: true, fileMustExist: true, timeout: 5_000 });
    try {
      const integrity = database.pragma("integrity_check", { simple: true });
      if (integrity !== "ok") throw new Error("备份完整性校验失败");
      const foreignKeyErrors = database.pragma("foreign_key_check") as unknown[];
      if (foreignKeyErrors.length > 0) throw new Error("备份外键一致性校验失败");

      const placeholders = REQUIRED_TABLES.map(() => "?").join(",");
      const rows = database.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`).all(...REQUIRED_TABLES) as Array<{ name: string }>;
      if (rows.length !== REQUIRED_TABLES.length) throw new Error("备份缺少博客核心数据表");

      const schemaVersion = database.pragma("user_version", { simple: true });
      return {
        path: backupPath,
        sizeBytes: stat.size,
        schemaVersion: typeof schemaVersion === "number" ? schemaVersion : 0,
      };
    } finally {
      database.close();
      // A readonly verification of a WAL-mode database may still create empty
      // sidecars on some SQLite builds. They are not part of the backup artifact.
      fs.rmSync(`${backupPath}-wal`, { force: true });
      fs.rmSync(`${backupPath}-shm`, { force: true });
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("备份")) throw error;
    throw new Error("备份校验失败：SQLite 文件无法读取或已损坏", { cause: error });
  }
}
