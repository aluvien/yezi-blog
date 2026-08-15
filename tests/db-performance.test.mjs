import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-db-performance-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const { db, listPostsByCategory, listPostsByTag, searchPosts } = await import("../src/lib/db.ts");
const SAMPLE_SIZE = 5_000;

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("database query-plan and timing baseline uses FTS and selective tag/category indexes", (context) => {
  const insertPost = db.prepare("INSERT INTO posts (title, slug, content, category, tags, created_at, updated_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'published')");
  const insertTag = db.prepare("INSERT INTO post_tags (post_id, tag, normalized_tag) VALUES (?, ?, ?)");
  const stamp = "2026-08-15T00:00:00.000Z";
  db.transaction(() => {
    for (let index = 0; index < SAMPLE_SIZE; index += 1) {
      const tagged = index % 10 === 0;
      const categorized = index % 5 === 0;
      const postId = Number(insertPost.run(
        `性能文章 ${index}`,
        `performance-${index}`,
        tagged ? "rarebenchmarktoken SQLite FTS" : "常规内容",
        categorized ? "性能" : "随笔",
        JSON.stringify(tagged ? ["性能"] : ["其它"]),
        stamp,
        stamp,
      ).lastInsertRowid);
      insertTag.run(postId, tagged ? "性能" : "其它", tagged ? "性能" : "其它");
    }
  })();

  const tagPlan = db.prepare(`EXPLAIN QUERY PLAN
    SELECT posts.* FROM post_tags INDEXED BY idx_post_tags_normalized_tag_post_id
    INNER JOIN posts ON posts.id = post_tags.post_id
    WHERE post_tags.normalized_tag = ? AND posts.status = 'published'
    ORDER BY posts.created_at DESC`).all("性能");
  const categoryPlan = db.prepare(`EXPLAIN QUERY PLAN
    SELECT * FROM posts WHERE status = 'published' AND category = ? COLLATE NOCASE
    ORDER BY created_at DESC`).all("性能");
  const ftsPlan = db.prepare("EXPLAIN QUERY PLAN SELECT rowid FROM fts_posts WHERE fts_posts MATCH ?").all("rarebenchmarktoken");

  assert.ok(tagPlan.some((row) => String(row.detail).includes("idx_post_tags_normalized_tag_post_id")));
  assert.ok(categoryPlan.some((row) => String(row.detail).includes("idx_posts_status_category_time")));
  assert.ok(ftsPlan.some((row) => String(row.detail).includes("VIRTUAL TABLE INDEX")));

  const measure = (operation) => {
    const started = performance.now();
    const result = operation();
    return { durationMs: Number((performance.now() - started).toFixed(2)), count: result.length };
  };
  const tag = measure(() => listPostsByTag("性能"));
  const category = measure(() => listPostsByCategory("性能"));
  const search = measure(() => searchPosts("rarebenchmarktoken"));
  assert.equal(tag.count, SAMPLE_SIZE / 10);
  assert.equal(category.count, SAMPLE_SIZE / 5);
  assert.equal(search.count, SAMPLE_SIZE / 10);
  context.diagnostic(JSON.stringify({ sampleSize: SAMPLE_SIZE, tag, category, search }));
});
