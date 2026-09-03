import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-posts-"));
process.env.BLOG_DB_PATH = path.join(tmpDir, "test.db");
process.env.BLOG_ROOT = tmpDir;

const {
  attachAttachmentsToPost,
  createAttachment,
  createPost,
  db,
  deletePost,
  getPost,
  getPostAttachments,
  getOrCreatePostShortLink,
  getPublishedPostByShortCode,
  generatePostShortCode,
  listArticleReferencesForPost,
  listPostSummaries,
  searchPublishedPostsForReference,
  syncArticleReferences,
  updatePost,
} = await import("../src/lib/db.ts");

test.after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("post writes preserve slug, state, attachment and reference invariants", () => {
  const first = createPost({ title: "同名文章", content: "草稿正文", status: "draft" });
  const second = createPost({ title: "同名文章", content: "另一篇正文", status: "published" });
  assert.notEqual(first.slug, second.slug, "自动 slug 必须保持唯一");
  assert.equal(first.status, "draft");

  const attachment = createAttachment({
    path: "/uploads/202608/post-test.png",
    original_name: "post-test.png",
    mime_type: "image/png",
    size: 42,
  });
  db.transaction(() => {
    const updated = updatePost(first.id, {
      title: "已发布文章",
      slug: first.slug,
      content: "发布后的正文",
      status: "published",
      tags: ["测试"],
    });
    assert.equal(updated?.status, "published");
    attachAttachmentsToPost([attachment.id], first.id);
    syncArticleReferences(first.id, [{
      url: "https://example.com/reference",
      canonicalUrl: "https://example.com/reference",
      title: "测试引用",
      source: "Example",
      author: "Author",
      publishedAt: "2026-08-15",
      cover: "",
      description: "描述",
      summary: "摘要",
      keyPoints: ["要点"],
    }]);
  })();

  assert.equal(getPostAttachments(first.id)[0]?.id, attachment.id);
  assert.equal(listArticleReferencesForPost(first.id)[0]?.canonical_url, "https://example.com/reference");
  syncArticleReferences(first.id, []);
  assert.equal(listArticleReferencesForPost(first.id).length, 0);

  const rollbackTitle = "必须回滚的文章";
  assert.throws(() => db.transaction(() => {
    createPost({ title: rollbackTitle, content: "不应提交", status: "draft" });
    throw new Error("intentional rollback");
  })(), /intentional rollback/);
  assert.equal(db.prepare("SELECT 1 FROM posts WHERE title = ?").get(rollbackTitle), undefined);

  deletePost(first.id);
  assert.equal(getPost(first.id), undefined);
  assert.equal(getPostAttachments(first.id).length, 0);
});

test("local article reference search only exposes published posts and bounds results", () => {
  createPost({ title: "可引用的本站文章", content: "这篇文章可被本站搜索引用。", status: "published" });
  createPost({ title: "不可公开引用", content: "草稿不应出现在本站引用搜索。", status: "draft" });

  const results = searchPublishedPostsForReference("本站搜索", 20);
  assert.deepEqual(results.map((post) => post.title), ["可引用的本站文章"]);
  assert.equal(searchPublishedPostsForReference("不可公开", 20).length, 0);
});

test("listPostSummaries truncates content in SQL while keeping summary fields intact", () => {
  const longContent = "长正文".repeat(10_000);
  const post = createPost({ title: "摘要截断", slug: "summary-truncate", content: longContent, category: "随笔", tags: [], status: "published" });
  const rows = listPostSummaries({ limit: 50, offset: 0 });
  const row = rows.find((item) => item.id === post.id);
  assert.ok(row);
  assert.equal(row.content.length, 4_096, "正文必须被 substr 截到前缀");
  assert.equal(row.title, post.title);
  assert.equal(row.slug, post.slug);
  assert.equal(row.updated_at, post.updated_at);
  assert.equal("status" in row, true);
  deletePost(post.id);
});

test("post short links keep a stable mixed-case code and resolve published posts", () => {
  const post = createPost({ title: "短链接文章", content: "正文", status: "published" });
  const first = getOrCreatePostShortLink(post.id);
  const second = getOrCreatePostShortLink(post.id);
  assert.match(first.code, /^[A-Za-z0-9]{8}$/);
  assert.match(first.code, /[A-Z]/);
  assert.match(first.code, /[a-z]/);
  assert.match(first.code, /[0-9]/);
  assert.deepEqual(second, first);
  assert.equal(getPublishedPostByShortCode(first.code)?.id, post.id);
  deletePost(post.id);
  assert.equal(getPublishedPostByShortCode(first.code), undefined);
  assert.match(generatePostShortCode(), /^[A-Za-z0-9]{8}$/);
});
