import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-search-route-"));
process.env.BLOG_ROOT = tmpDir;
process.env.BLOG_DB_PATH = path.join(tmpDir, "blog.db");
process.env.TRUST_PROXY = "false";

const { createPost, db } = await import("../src/lib/db.ts");
const { GET: searchGet } = await import("../src/app/api/v1/search/route.ts");

test.after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("public search rate-limits repeated anonymous requests", () => {
  createPost({ title: "搜索限频", content: "搜索接口测试内容", status: "published" });
  const request = () => new Request("https://yezi.test/api/v1/search?q=%E6%90%9C%E7%B4%A2");
  for (let index = 0; index < 60; index += 1) {
    assert.equal(searchGet(request()).status, 200);
  }
  assert.equal(searchGet(request()).status, 429);
});
