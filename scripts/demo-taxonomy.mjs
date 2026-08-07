/**
 * 为已有本地演示库补充分类和标签：npm run demo:taxonomy
 *
 * 这是幂等脚本：重复执行只会把演示文章调整到同一组分类/标签，不会复制分类。
 * 不会删除文章、想法、作品、评论或音乐设置。
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredDbPath = process.env.BLOG_DB_PATH?.trim();
const dbPath = configuredDbPath ? path.resolve(configuredDbPath) : path.join(root, "data", "blog.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const hasPosts = db
  .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'posts'")
  .get();
if (!hasPosts) {
  db.close();
  throw new Error("未找到 posts 表，请先运行 npm run seed 或启动一次网站初始化数据库。");
}

db.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )
`);

const categories = ["生活随笔", "技术实践", "阅读笔记", "音乐与影像"];
const demos = [
  { title: "欢迎来到我的博客", slug: "welcome", category: "技术实践", tags: ["Next.js", "SQLite", "全栈"] },
  { title: "Markdown 排版示例", slug: "markdown-demo", category: "技术实践", tags: ["Markdown", "排版", "写作"] },
  { title: "意义", slug: "meaning", category: "阅读笔记", tags: ["阅读", "生活", "思考"] },
  { title: "失衡的代价", slug: "88", category: "生活随笔", tags: ["生活", "自我成长"] },
  { title: "好久好久", slug: "long-long-long", category: "生活随笔", tags: ["生活", "随笔", "摄影"] },
  { title: "音乐内嵌测试", slug: "music-test-1785699172238", category: "音乐与影像", tags: ["音乐", "网易云", "前端"] },
];

const now = () => new Date().toISOString();
const insertCategory = db.prepare(
  "INSERT OR IGNORE INTO categories (name, slug, created_at) VALUES (?, ?, ?)",
);
const findPost = db.prepare("SELECT id, category, tags FROM posts WHERE slug = ? OR title = ? LIMIT 1");
const updatePost = db.prepare("UPDATE posts SET category = ?, tags = ?, updated_at = ? WHERE id = ?");

const run = db.transaction(() => {
  for (const name of categories) insertCategory.run(name, name, now());

  let updated = 0;
  let skipped = 0;
  let unchanged = 0;
  for (const demo of demos) {
    const post = findPost.get(demo.slug, demo.title);
    if (!post) {
      skipped += 1;
      continue;
    }
    const tags = JSON.stringify(demo.tags);
    if (post.category === demo.category && post.tags === tags) {
      unchanged += 1;
      continue;
    }
    updatePost.run(demo.category, tags, now(), post.id);
    updated += 1;
  }
  return { updated, skipped, unchanged };
});

const result = run();
const categoryCount = db.prepare("SELECT COUNT(*) AS count FROM categories").get().count;
const tagCount = new Set(
  db
    .prepare("SELECT tags FROM posts")
    .all()
    .flatMap((row) => {
      try {
        return JSON.parse(row.tags || "[]");
      } catch {
        return [];
      }
    }),
).size;

db.close();
console.log(
  `演示分类/标签完成：更新 ${result.updated} 篇文章，${result.unchanged} 篇已是目标数据，跳过 ${result.skipped} 个不存在的文章；共 ${categoryCount} 个分类、${tagCount} 个标签。`,
);
