import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

// 用临时 SQLite 文件验证 FTS5 全文搜索（触发器同步 + rebuild + 子串匹配），
// 避免读写真实 data/blog.db。必须在 import db.ts 之前设置环境变量。
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-search-"));
process.env.BLOG_DB_PATH = path.join(tmpDir, "test.db");
process.env.BLOG_ROOT = tmpDir;

const { db, createPost, createMoment, updatePost, deletePost, searchPosts, searchMoments } = await import("../src/lib/db.ts");

test.after(() => {
  try {
    db.close();
  } catch {
    // 数据库可能已关闭。
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FTS finds published posts by content substring", () => {
  const hit = createPost({ title: "React 入门", content: "这是一篇前端框架教程", status: "published" });
  createPost({ title: "后端漫谈", content: "Node 与数据库", status: "published" });
  createPost({ title: "草稿", content: "前端框架草稿", status: "draft" });
  const results = searchPosts("前端框架");
  assert.ok(results.some((post) => post.id === hit.id));
  assert.ok(results.every((post) => post.status === "published"));
});

test("FTS matches title, category and tags (short queries fall back to scan)", () => {
  const post = createPost({ title: "设计心得", content: "正文", category: "设计", tags: ["视觉"], status: "published" });
  assert.ok(searchPosts("设计心得").some((item) => item.id === post.id));
  assert.ok(searchPosts("设计").some((item) => item.id === post.id));
  assert.ok(searchPosts("视觉").some((item) => item.id === post.id));
});

test("searchMoments matches content substring", () => {
  const moment = createMoment({ content: "今天学了 Next.js 与 SQLite" });
  assert.ok(searchMoments("SQLite").some((item) => item.id === moment.id));
  assert.ok(searchMoments("Next.js").some((item) => item.id === moment.id));
  assert.ok(searchMoments("今天学了").some((item) => item.id === moment.id));
});

test("empty or whitespace query returns no results", () => {
  assert.deepEqual(searchPosts(""), []);
  assert.deepEqual(searchPosts("   "), []);
  assert.deepEqual(searchMoments(""), []);
});

test("FTS stays in sync on update and delete", () => {
  const post = createPost({ title: "同步测试", content: "原始独特标记 sync001", status: "published" });
  assert.equal(searchPosts("sync001").length, 1);
  updatePost(post.id, { title: "同步测试改", content: "更新独特标记 sync002", slug: post.slug });
  assert.equal(searchPosts("sync001").length, 0, "更新后旧内容应从索引移除");
  assert.equal(searchPosts("sync002").length, 1, "更新后新内容应可搜索");
  deletePost(post.id);
  assert.equal(searchPosts("sync002").length, 0, "删除后应从索引移除");
  assert.equal(db.prepare("SELECT count(*) AS c FROM fts_posts").get().c, db.prepare("SELECT count(*) AS c FROM posts").get().c);
});
