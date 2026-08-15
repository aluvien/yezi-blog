import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { verifyDatabaseBackup } from "../src/lib/backup-verification.ts";

// 手动备份入口。每日自动调度版见 src/lib/backup.ts；两条路径都使用 SQLite
// online backup API，并在成功前以全新只读连接执行 integrity_check。
const root = process.cwd();
const source = path.resolve(process.env.BLOG_DB_PATH || path.join(root, "data", "blog.db"));
if (!fs.existsSync(source)) {
  console.error(`数据库不存在：${source}`);
  process.exit(1);
}

const backupDir = path.join(root, "data", "backups");
fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
fs.chmodSync(backupDir, 0o700);
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const target = path.join(backupDir, `blog-${stamp}.db`);
const db = new Database(source, { readonly: true });
try {
  await db.backup(target);
  fs.chmodSync(target, 0o600);
  const verification = verifyDatabaseBackup(target);
  console.log(`备份完成并通过完整性校验：${verification.path}（schema v${verification.schemaVersion}，${verification.sizeBytes} bytes）`);
} catch (error) {
  fs.rmSync(target, { force: true });
  throw error;
} finally {
  db.close();
}

// 保留最近 BACKUP_KEEP 份（默认 30），超出按修改时间倒序清理。
const keep = Number.parseInt(process.env.BACKUP_KEEP ?? "30", 10);
if (Number.isFinite(keep) && keep > 0) {
  const stale = fs.readdirSync(backupDir)
    .filter((name) => name.startsWith("blog-") && name.endsWith(".db"))
    .map((name) => ({ name, mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(keep);
  for (const file of stale) {
    fs.unlinkSync(path.join(backupDir, file.name));
    console.log(`已清理旧备份：${file.name}`);
  }
}
