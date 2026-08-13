/**
 * 演示数据初始化脚本：npm run seed
 * 仅当 posts / moments / works 三张表都为空时才插入，避免污染已有数据。
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredDbPath = process.env.BLOG_DB_PATH?.trim();
const dbPath = configuredDbPath ? path.resolve(configuredDbPath) : path.join(root, "data", "blog.db");
const dataDir = path.dirname(dbPath);
fs.mkdirSync(dataDir, { recursive: true });
const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL DEFAULT '',
    cover TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published'))
  );
  CREATE TABLE IF NOT EXISTS moments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content TEXT NOT NULL,
    images TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS works (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    cover TEXT,
    link TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target_type TEXT NOT NULL CHECK (target_type IN ('post','moment')),
    target_id INTEGER NOT NULL,
    nickname TEXT NOT NULL,
    email TEXT,
    content TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved')),
    created_at TEXT NOT NULL,
    admin_reply TEXT,
    replied_at TEXT
  );
`);

const count = (t) => db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
if (count("posts") > 0 || count("moments") > 0 || count("works") > 0) {
  console.log("数据表非空，跳过 seed（不会污染已有数据）。");
  process.exit(0);
}

const HOUR = 3600 * 1000;
const ts = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR).toISOString();

const insertPost = db.prepare(
  "INSERT INTO posts (title, slug, content, cover, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, 'published')",
);
const insertMoment = db.prepare("INSERT INTO moments (content, images, created_at, updated_at) VALUES (?, ?, ?, ?)");
const insertWork = db.prepare(
  "INSERT INTO works (title, description, cover, link, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)",
);
const insertComment = db.prepare(
  "INSERT INTO comments (target_type, target_id, nickname, email, content, ip, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
);

const seed = db.transaction(() => {
  const post1 = insertPost.run(
    "欢迎来到我的博客",
    "welcome",
    `欢迎来到我的小站。这里会记录一些长文、随手的想法，以及做过的作品。

## 为什么会写博客

> 写作是把模糊的想法变清晰的最好方式。

一直以来都想有一个属于自己的角落，不依赖任何平台。这个博客用 Next.js 和 SQLite 搭建，足够简单，也足够自由。

## 这个博客有什么

- **文章**：比较系统的长文
- **想法**：类似朋友圈的短内容
- **作品**：做过的一些小项目

## 一段代码

建站的第一行代码当然是：

\`\`\`bash
npx create-next-app@latest yezi-blog
\`\`\`

希望这里能慢慢积累一些有留存价值的内容。`,
    null,
    ts(72),
    ts(72),
  );

  const post2 = insertPost.run(
    "Markdown 排版示例",
    "markdown-demo",
    `这篇文章用来演示博客正文的各种排版元素。

## 标题层级

### 三级标题

正文段落之间留有足够的间距，长时间阅读不会累。中文排版行高 1.75，字号 17px。

## 引用

> 一个人知道自己为什么而活，就可以忍受任何一种生活。
>
> —— 尼采

## 列表

1. 第一项
2. 第二项
3. 第三项

无序列表：

- 苹果
- 香蕉
- 橙子

## 代码

行内代码：\`const a = 1\`，以及代码块：

\`\`\`ts
function greet(name: string): string {
  return \`你好，\${name}\`;
}
\`\`\`

以上就是全部示例。`,
    null,
    ts(24),
    ts(24),
  );

  insertMoment.run(
    "博客终于上线了，折腾了一个周末，值得纪念一下。",
    JSON.stringify([]),
    ts(50),
    ts(50),
  );
  const moment2 = insertMoment.run(
    "今天天气不错，出门拍了几张照片。占位图先顶上，回头换真图。",
    JSON.stringify(["/placeholder.svg", "/placeholder.svg", "/placeholder.svg", "/placeholder.svg"]),
    ts(30),
    ts(30),
  );
  insertMoment.run(
    "读《纳瓦尔宝典》，印象最深的一句：用好奇心代替焦虑。",
    JSON.stringify([]),
    ts(5),
    ts(5),
  );

  insertWork.run(
    "Yezi's Blog",
    "你现在看到的这个博客：Next.js + SQLite，前后台一体，支持文章、想法、作品和评论。",
    "/placeholder.svg",
    "https://example.com",
    1,
    ts(40),
  );
  insertWork.run(
    "示例作品二号",
    "这是一个占位作品，用来演示作品集的网格布局与外链跳转。",
    "/placeholder.svg",
    "https://example.com",
    2,
    ts(35),
  );

  const p1 = Number(post1.lastInsertRowid);
  const p2 = Number(post2.lastInsertRowid);
  const m2 = Number(moment2.lastInsertRowid);
  insertComment.run("post", p1, "路人甲", null, "沙发！博客样式很舒服。", "127.0.0.1", "approved", ts(60));
  insertComment.run("post", p1, "老朋友们", null, "终于有自己的站了，恭喜恭喜。", "127.0.0.1", "approved", ts(48));
  insertComment.run("post", p2, "排版控", null, "引用块和代码块的样式真不错。", "127.0.0.1", "approved", ts(12));
  insertComment.run("moment", m2, "摄影爱好者", null, "等你的真图！", "127.0.0.1", "approved", ts(20));
  insertComment.run("post", p1, "待审核用户", null, "这条评论用于演示审核流程，审核后展示。", "127.0.0.1", "pending", ts(1));
});

seed();
console.log("seed 完成：2 篇文章、3 条想法、2 个作品、5 条评论（4 条已审核、1 条待审核）。");
