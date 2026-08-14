import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { getProjectRoot } from "@/lib/uploads";

const DEFAULT_KEEP = 30;

export interface DbBackupResult {
  /** 生成的备份文件绝对路径。 */
  path: string;
  /** 备份文件名里的时间戳（YYYYMMDDHHMM）。 */
  stamp: string;
  /** 本次清理掉的旧备份文件名。 */
  cleaned: string[];
}

/**
 * 用 SQLite online backup API 生成带时间戳的只读快照，并清理超出保留份数的旧备份。
 * 后台每日调度（backup-scheduler.ts）与手动命令（scripts/backup.mjs）共用同一套
 * 目标格式；手动脚本逻辑保持独立，改动时应保持两者行为一致。
 */
export async function runDbBackup(options: { keep?: number; dbPath?: string } = {}): Promise<DbBackupResult> {
  const root = getProjectRoot();
  const source = path.resolve(
    options.dbPath ?? process.env.BLOG_DB_PATH?.trim() ?? path.join(root, "data", "blog.db"),
  );
  if (!fs.existsSync(source)) throw new Error(`数据库不存在：${source}`);

  const backupDir = path.join(root, "data", "backups");
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.chmodSync(backupDir, 0o700);
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const target = path.join(backupDir, `blog-${stamp}.db`);

  const db = new Database(source, { readonly: true });
  try {
    await db.backup(target);
    fs.chmodSync(target, 0o600);
  } finally {
    db.close();
  }

  const parsedKeep = Number.parseInt(String(options.keep ?? process.env.BACKUP_KEEP ?? ""), 10);
  const keep = Number.isFinite(parsedKeep) && parsedKeep > 0 ? parsedKeep : DEFAULT_KEEP;
  const cleaned: string[] = [];
  const stale = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith("blog-") && name.endsWith(".db"))
    .map((name) => ({ name, mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(keep);
  for (const file of stale) {
    fs.unlinkSync(path.join(backupDir, file.name));
    cleaned.push(file.name);
  }
  return { path: target, stamp, cleaned };
}

/** 最近一次备份文件的修改时间戳（毫秒），从未备份过则返回 null。 */
export function lastBackupTimestamp(): number | null {
  const backupDir = path.join(getProjectRoot(), "data", "backups");
  if (!fs.existsSync(backupDir)) return null;
  const timestamps = fs
    .readdirSync(backupDir)
    .filter((name) => name.startsWith("blog-") && name.endsWith(".db"))
    .map((name) => fs.statSync(path.join(backupDir, name)).mtimeMs)
    .sort((a, b) => b - a);
  return timestamps[0] ?? null;
}
