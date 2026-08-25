import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = path.resolve(process.env.BLOG_ROOT || process.cwd());
const databasePath = path.resolve(process.env.BLOG_DB_PATH || path.join(root, "data", "blog.db"));
if (!fs.existsSync(databasePath)) throw new Error(`数据库不存在：${databasePath}`);

const database = new Database(databasePath, { timeout: 5_000 });
try {
  database.pragma("foreign_keys = ON");
  const generation = database.transaction(() => {
    const row = database.prepare("SELECT session_generation FROM auth_state WHERE singleton = 1").get();
    if (!row) throw new Error("auth_state 尚未初始化，请先使用当前版本启动一次服务完成迁移");
    const next = Number(row.session_generation) + 1;
    database.prepare("UPDATE auth_state SET session_generation = ?, updated_at = ? WHERE singleton = 1")
      .run(next, new Date().toISOString());
    database.prepare("DELETE FROM sessions").run();
    return next;
  })();
  console.log(`全部管理员会话已撤销（generation=${generation}）`);
} finally {
  database.close();
}
