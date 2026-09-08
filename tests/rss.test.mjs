import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-rss-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");
process.env.NEXT_PUBLIC_SITE_URL = "https://yezi.test";

const { createMoment, createPost, db } = await import("../src/lib/db.ts");
const { GET } = await import("../src/app/rss.xml/route.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("RSS always emits canonical post and moment URLs regardless of theme", async () => {
  const post = createPost({ title: "RSS 文章", content: "正文", slug: "rss-post", status: "published" });
  const moment = createMoment({ content: "RSS 絮语" });
  const xml = await GET().text();

  assert.match(xml, new RegExp(`https://yezi\\.test/posts/${post.slug}`));
  assert.match(xml, new RegExp(`https://yezi\\.test/moments#moment-${moment.id}`));
  assert.doesNotMatch(xml, /\/essay\//);
  assert.doesNotMatch(xml, /\/bits#/);
});
