/**
 * 小记演示数据：给「生活节点」和「GitHub」提供可重复运行的本地样例。
 * 已存在同标题/同日期节点或同 full_name 仓库时跳过，不覆盖真实数据。
 */
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredDbPath = process.env.BLOG_DB_PATH?.trim();
const dbPath = configuredDbPath ? path.resolve(configuredDbPath) : path.join(root, "data", "blog.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

const tableExists = (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
if (!tableExists("life_events") || !tableExists("github_repositories")) {
  db.close();
  throw new Error("缺少 life_events 或 github_repositories 表，请先启动一次网站完成数据库迁移。");
}

const lifeEvents = [
  {
    title: "博客新版本上线",
    content: "把文章、絮语、作品和小记重新整理了一遍，也终于把这个小站部署到了线上。",
    occurred_at: "2026-08-28",
    date_precision: "day",
    tags: ["建站", "记录"],
    location: "杭州",
  },
  {
    title: "第一次独自远行",
    content: "在陌生的街区走了很久，记下几段沿途的光影，回程时才发现已经走了两万多步。",
    occurred_at: "2026-07-15",
    date_precision: "day",
    tags: ["生活", "旅行"],
    location: "苏州",
  },
  {
    title: "开始整理生活节点",
    content: "把散落在想法里的片段重新归档，让时间留下可以回看的索引。",
    occurred_at: "2025-12-01",
    date_precision: "month",
    tags: ["生活", "整理"],
    location: "",
  },
];

const repositories = [
  {
    owner: "aluvien",
    name: "yezi-blog",
    full_name: "aluvien/yezi-blog",
    repo_url: "https://github.com/aluvien/yezi-blog",
    custom_title: "Yezi's Blog",
    custom_description: "一个记录文章、絮语、作品与生活节点的个人博客。",
    description: "个人博客与生活记录站点。",
    primary_language: "TypeScript",
    topics: ["nextjs", "sqlite", "blog"],
    tags: ["项目", "前端"],
    registered_at: "2026-08-27T12:00:00.000Z",
  },
  {
    owner: "vercel",
    name: "next.js",
    full_name: "vercel/next.js",
    repo_url: "https://github.com/vercel/next.js",
    custom_title: "Next.js",
    custom_description: "用于构建全栈 Web 应用的 React 框架。",
    description: "The React Framework for the Web.",
    primary_language: "JavaScript",
    topics: ["react", "nextjs", "framework"],
    tags: ["工具", "前端"],
    registered_at: "2026-08-18T12:00:00.000Z",
  },
  {
    owner: "sqlite",
    name: "sqlite",
    full_name: "sqlite/sqlite",
    repo_url: "https://github.com/sqlite/sqlite",
    custom_title: "SQLite",
    custom_description: "小而可靠的本地数据库，也是这个博客的数据底座。",
    description: "The SQLite source tree.",
    primary_language: "C",
    topics: ["database", "embedded", "sql"],
    tags: ["工具", "数据库"],
    registered_at: "2026-08-06T12:00:00.000Z",
  },
];

const now = () => new Date().toISOString();
const insertLifeEvent = db.prepare(`
  INSERT INTO life_events
    (title, content, occurred_at, date_precision, cover, images, tags, location, source_type, source_moment_id, created_at, updated_at)
  VALUES (?, ?, ?, ?, NULL, '[]', ?, ?, 'manual', NULL, ?, ?)
`);
const insertRepository = db.prepare(`
  INSERT INTO github_repositories
    (owner, name, full_name, repo_url, description, homepage, primary_language, topics, stars, forks, license,
     default_branch, archived, visibility, github_created_at, github_updated_at, pushed_at, custom_title,
     custom_description, cover, tags, featured, registered_at, synced_at, sync_status, sync_error, updated_at)
  VALUES (?, ?, ?, ?, ?, '', ?, ?, 0, 0, '', 'main', 0, 'public', '', '', '', ?, ?, NULL, ?, 1, ?, ?, 'success', '', ?)
`);

const run = db.transaction(() => {
  let lifeInserted = 0;
  let lifeSkipped = 0;
  let githubInserted = 0;
  let githubSkipped = 0;

  for (const item of lifeEvents) {
    const existing = db.prepare("SELECT id FROM life_events WHERE title = ? AND occurred_at = ? LIMIT 1").get(item.title, item.occurred_at);
    if (existing) {
      lifeSkipped += 1;
      continue;
    }
    const ts = now();
    insertLifeEvent.run(item.title, item.content, item.occurred_at, item.date_precision, JSON.stringify(item.tags), item.location, ts, ts);
    lifeInserted += 1;
  }

  for (const repo of repositories) {
    const existing = db.prepare("SELECT id FROM github_repositories WHERE full_name = ? LIMIT 1").get(repo.full_name);
    if (existing) {
      githubSkipped += 1;
      continue;
    }
    const ts = now();
    insertRepository.run(
      repo.owner,
      repo.name,
      repo.full_name,
      repo.repo_url,
      repo.description,
      repo.primary_language,
      JSON.stringify(repo.topics),
      repo.custom_title,
      repo.custom_description,
      JSON.stringify(repo.tags),
      repo.registered_at,
      ts,
      ts,
    );
    githubInserted += 1;
  }

  return { lifeInserted, lifeSkipped, githubInserted, githubSkipped };
});

const result = run();
db.close();
console.log(
  `小记演示数据完成：生活节点新增 ${result.lifeInserted} 条、跳过 ${result.lifeSkipped} 条；GitHub 新增 ${result.githubInserted} 个、跳过 ${result.githubSkipped} 个。`,
);
