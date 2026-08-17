import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-reference-library-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const {
  db,
  listReferenceLibrary,
  listReferenceLibraryTags,
  updateReferenceLibraryMetadata,
  upsertReferenceLibrarySnapshot,
} = await import("../src/lib/db.ts");

const snapshot = {
  url: "https://example.com/reference-library-tags",
  canonicalUrl: "https://example.com/reference-library-tags",
  title: "带标签的引用",
  source: "示例来源",
  author: "作者",
  publishedAt: "2026-08-18",
  cover: "",
  description: "",
  summary: "",
  keyPoints: [],
};

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("reference library persists normalized tags, exposes suggestions, and keeps metadata through content refresh", () => {
  const created = upsertReferenceLibrarySnapshot(snapshot, { category: "技术", tags: "AI， #架构, ai" });
  assert.equal(created.category, "技术");
  assert.equal(created.tags, '["AI","架构"]');

  // 后台归档/正文同步只刷新页面元信息，不能覆盖管理员专门维护的分类与标签。
  const refreshed = upsertReferenceLibrarySnapshot({ ...snapshot, summary: "已刷新摘要" });
  assert.equal(refreshed.category, "技术");
  assert.equal(refreshed.tags, '["AI","架构"]');
  assert.equal(refreshed.summary, "已刷新摘要");

  assert.deepEqual(
    listReferenceLibraryTags().map(({ tag, count }) => `${tag}:${count}`).sort(),
    ["AI:1", "架构:1"].sort(),
  );

  assert.equal(updateReferenceLibraryMetadata(created.id, "阅读", "数据库, AI"), true);
  const updated = listReferenceLibrary({ keyword: "数据库" });
  assert.equal(updated.length, 1);
  assert.equal(updated[0].category, "阅读");
  assert.equal(updated[0].tags, '["数据库","AI"]');
});
