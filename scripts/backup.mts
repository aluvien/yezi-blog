import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import crypto from "node:crypto";
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
const lockPath = path.join(backupDir, ".backup.lock");
let lockFd: number;
try {
  lockFd = fs.openSync(lockPath, "wx", 0o600);
} catch {
  console.error("已有备份任务正在执行");
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "");
const target = path.join(backupDir, `blog-${stamp}-${crypto.randomBytes(4).toString("hex")}.db`);
const temporary = `${target}.${process.pid}.tmp`;
let db: Database.Database | undefined;
try {
  db = new Database(source, { readonly: true });
  await db.backup(temporary);
  fs.chmodSync(temporary, 0o600);
  const verification = verifyDatabaseBackup(temporary);
  fs.renameSync(temporary, target);
  console.log(`备份完成并通过完整性校验：${target}（schema v${verification.schemaVersion}，${verification.sizeBytes} bytes）`);
} catch (error) {
  fs.rmSync(temporary, { force: true });
  fs.rmSync(target, { force: true });
  throw error;
} finally {
  db?.close();
  fs.closeSync(lockFd!);
  fs.rmSync(lockPath, { force: true });
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
    const stalePath = path.join(backupDir, file.name);
    fs.unlinkSync(stalePath);
    fs.rmSync(`${stalePath}-wal`, { force: true });
    fs.rmSync(`${stalePath}-shm`, { force: true });
    console.log(`已清理旧备份：${file.name}`);
  }
}
for (const name of fs.readdirSync(backupDir).filter((item) => /^blog-.*\.db-(?:wal|shm)$/.test(item))) {
  fs.rmSync(path.join(backupDir, name), { force: true });
}
