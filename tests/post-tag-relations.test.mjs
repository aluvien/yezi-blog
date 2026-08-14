import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-post-tags-"));
process.env.BLOG_DB_PATH = path.join(tmpDir, "test.db");
process.env.BLOG_ROOT = tmpDir;

const { db, createPost, deletePost, listPostsByTag, listRelatedPosts, updatePost } = await import("../src/lib/db.ts");

test.after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("post tags are backfilled and kept synchronized on create, update and delete", () => {
  const post = createPost({ title: "标签同步", content: "正文", tags: ["TypeScript", "数据库"], status: "published" });
  assert.deepEqual(
    db.prepare("SELECT tag, normalized_tag FROM post_tags WHERE post_id = ? ORDER BY normalized_tag").all(post.id),
    [{ tag: "TypeScript", normalized_tag: "typescript" }, { tag: "数据库", normalized_tag: "数据库" }],
  );
  assert.ok(listPostsByTag("TYPESCRIPT").some((item) => item.id === post.id));

  updatePost(post.id, { title: post.title, slug: post.slug, content: post.content, tags: ["性能"], status: "published" });
  assert.equal(listPostsByTag("TypeScript").some((item) => item.id === post.id), false);
  assert.ok(listPostsByTag("性能").some((item) => item.id === post.id));

  deletePost(post.id);
  assert.equal(db.prepare("SELECT count(*) AS count FROM post_tags WHERE post_id = ?").get(post.id).count, 0);
});

test("related posts include an older matching article before recent unrelated candidates", () => {
  const olderRelated = createPost({ title: "较早但相关", content: "正文", tags: ["SQLite"], status: "published" });
  db.prepare("UPDATE posts SET created_at = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", olderRelated.id);
  for (let index = 0; index < 10; index += 1) {
    createPost({ title: `近期无关 ${index}`, content: "正文", tags: ["其它"], status: "published" });
  }
  const current = createPost({ title: "当前文章", content: "正文", tags: ["SQLite"], status: "published" });
  const related = listRelatedPosts(current.id, 3);
  assert.equal(related[0]?.id, olderRelated.id);
  assert.equal(related.length, 3);
});
