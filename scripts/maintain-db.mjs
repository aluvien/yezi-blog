import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const root = process.cwd();
const dbPath = path.resolve(process.env.BLOG_DB_PATH || path.join(root, "data", "blog.db"));
if (fs.existsSync(dbPath)) {
  const db = new Database(dbPath, { timeout: 5000 });
  try {
    const now = Date.now();
    const iso = (milliseconds) => new Date(now - milliseconds).toISOString();
    db.pragma("journal_mode = WAL");
    db.transaction(() => {
      db.prepare("DELETE FROM content_interactions WHERE target_type = 'moment' AND kind = 'view' AND created_at < ?").run(iso(30 * 24 * 60 * 60 * 1000));
      db.prepare("DELETE FROM content_interactions WHERE target_type = 'post' AND kind = 'view' AND created_at < ?").run(iso(180 * 24 * 60 * 60 * 1000));
      db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now);
      db.prepare("DELETE FROM login_attempts WHERE first_failed_at < ?").run(now - 24 * 60 * 60 * 1000);
      // 早期演示数据的文案曾让“待审核”评论看起来像已被前台展示；
      // 只按精确昵称和旧文案迁移，避免触碰真实用户评论。
      db.prepare(`
        UPDATE comments
        SET status = 'pending', content = ?
        WHERE nickname = ? AND content = ?
      `).run("这条评论用于演示审核流程，审核后展示。", "待审核用户", "这条评论默认待审核，前台不可见。");
    })();
    db.pragma("optimize");
  } catch (error) {
    // Maintenance is best-effort; the application can still start and perform
    // per-request expiry checks when a database is temporarily busy.
    console.warn(`[db-maintenance] ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    db.close();
  }
}
