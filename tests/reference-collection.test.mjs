import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-ref-collect-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const {
  db,
  upsertReferenceLibrarySnapshot,
  getReferenceLibraryItem,
  updateReferenceLibraryCollection,
} = await import("../src/lib/db.ts");

const { articleReferenceToken, normalizeArticleReferenceSnapshot } = await import("../src/lib/article-reference.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("newly saved references carry a saved_at distinct from published_at", () => {
  const created = upsertReferenceLibrarySnapshot({
    url: "https://example.com/post", canonicalUrl: "https://example.com/post", title: "文章", source: "s", author: "", publishedAt: "2020-01-01", cover: "", description: "", summary: "", keyPoints: [],
  }, { category: "阅读", tags: "next" });
  assert.ok(created.saved_at, "插入时写入 saved_at");
  assert.equal(created.published_at, "2020-01-01", "published_at 仍是原文发布时间");
  assert.equal(created.status, "inbox");
  assert.equal(created.favorite, 0);
});

test("collection edits update note/status/favorite without touching untouched fields", () => {
  const created = upsertReferenceLibrarySnapshot({
    url: "https://example.com/a", canonicalUrl: "https://example.com/a", title: "A", source: "s", author: "", publishedAt: "", cover: "", description: "", summary: "", keyPoints: [],
  }, { category: "技术", tags: "ios" });
  const savedAt = created.saved_at;

  updateReferenceLibraryCollection(created.id, { note: "缓存升级重点参考", favorite: true, status: "read" });
  const after = getReferenceLibraryItem(created.id);
  assert.equal(after.note, "缓存升级重点参考");
  assert.equal(after.favorite, 1);
  assert.equal(after.status, "read");
  // 未传的 category/tags/saved_at 保持不变。
  assert.equal(after.category, "技术");
  assert.equal(after.tags, '["ios"]');
  assert.equal(after.saved_at, savedAt);
});

test("content refresh preserves the collection time and status (never resets saved_at)", () => {
  const created = upsertReferenceLibrarySnapshot({
    url: "https://example.com/b", canonicalUrl: "https://example.com/b", title: "B", source: "s", author: "", publishedAt: "", cover: "", description: "", summary: "", keyPoints: [],
  }, { status: "x" });
  updateReferenceLibraryCollection(created.id, { status: "archived" });
  const originalSavedAt = getReferenceLibraryItem(created.id).saved_at;
  // 模拟后台归档/正文同步只刷新元信息。
  upsertReferenceLibrarySnapshot({ url: "https://example.com/b", canonicalUrl: "https://example.com/b", title: "B", source: "s", author: "me", publishedAt: "", cover: "", description: "", summary: "刷新摘要", keyPoints: [] });
  const after = getReferenceLibraryItem(created.id);
  assert.equal(after.summary, "刷新摘要", "内容刷新写入非空字段");
  assert.equal(after.status, "archived", "收藏状态不被内容刷新覆盖");
  assert.equal(after.saved_at, originalSavedAt, "收藏时间不被内容刷新覆盖");
});

test("tracking parameters collapse to one canonical so duplicates dedupe", () => {
  const clean = normalizeArticleReferenceSnapshot({ url: "https://example.com/post?utm_source=twitter&utm_medium=t", canonicalUrl: "https://example.com/post?utm_source=twitter&utm_medium=t", title: "x", source: "", author: "", publishedAt: "", cover: "", description: "", summary: "", keyPoints: [] });
  assert.equal(clean.canonicalUrl.includes("utm_source"), false, "utm_* 被移除");

  // 只有 tracking 参数不同的两条链接，token 相同 → 资料库按 canonical 去重成一条。
  const withUtm = "https://docs.example.com/guide?utm_campaign=spring&page=2#top";
  const withoutUtm = "https://docs.example.com/guide?page=2";
  assert.equal(articleReferenceToken({ url: withUtm, canonicalUrl: withUtm }), articleReferenceToken({ url: withoutUtm, canonicalUrl: withoutUtm }));

  // 内容型 query（?page= / ?id=）与 spm 必须保留。
  const contentful = normalizeArticleReferenceSnapshot({ url: "https://shop.example.com/item?id=42&spm=a.b.c", canonicalUrl: "", title: "x", source: "", author: "", publishedAt: "", cover: "", description: "", summary: "", keyPoints: [] });
  assert.ok(contentful.canonicalUrl.includes("id=42"));
  assert.ok(contentful.canonicalUrl.includes("spm="), "spm 可能定位内容，保守保留");
});
