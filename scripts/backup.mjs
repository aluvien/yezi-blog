import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const source = path.resolve(process.env.BLOG_DB_PATH || path.join(root, "data", "blog.db"));
if (!fs.existsSync(source)) {
  console.error(`数据库不存在：${source}`);
  process.exit(1);
}

const backupDir = path.join(root, "data", "backups");
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
const target = path.join(backupDir, `blog-${stamp}.db`);
const db = new Database(source, { readonly: true });
try {
  await db.backup(target);
  console.log(`备份完成：${target}`);
} finally {
  db.close();
}

// 保留最近 BACKUP_KEEP 份（默认 30），超出按修改时间倒序清理。
// 可配合 cron / PM2 定时调用本脚本实现滚动备份。
const KEEP = Number.parseInt(process.env.BACKUP_KEEP ?? "30", 10);
if (Number.isFinite(KEEP) && KEEP > 0) {
  const stale = fs.readdirSync(backupDir)
    .filter((name) => name.startsWith("blog-") && name.endsWith(".db"))
    .map((name) => ({ name, mtime: fs.statSync(path.join(backupDir, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(KEEP);
  for (const file of stale) {
    fs.unlinkSync(path.join(backupDir, file.name));
    console.log(`已清理旧备份：${file.name}`);
  }
}
