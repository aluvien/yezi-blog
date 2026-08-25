import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-feed-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const { countPublicFeedItems, db, listPublicFeedPage } = await import("../src/lib/db.ts");
const { GET } = await import("../src/app/api/v1/feed/route.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("feed pages lightweight references before hydrating only the selected rows", () => {
  const insertPost = db.prepare(`
    INSERT INTO posts (title, slug, content, created_at, updated_at, status)
    VALUES (?, ?, ?, ?, ?, 'published')
  `);
  const insertMoment = db.prepare(`
    INSERT INTO moments (content, images, created_at, updated_at)
    VALUES (?, '[]', ?, ?)
  `);
  const populate = db.transaction(() => {
    for (let index = 0; index < 600; index += 1) {
      const stamp = new Date(Date.UTC(2026, 0, 1, 0, 0, Math.floor(index / 2))).toISOString();
      insertPost.run(`Post ${index}`, `post-${index}`, `post-body-${index}`, stamp, stamp);
      insertMoment.run(`moment-body-${index}`, stamp, stamp);
    }
  });
  populate();

  const first = listPublicFeedPage(25, 0);
  const second = listPublicFeedPage(25, 25);
  assert.equal(countPublicFeedItems(), 1_200);
  assert.equal(first.length, 25);
  assert.equal(second.length, 25);
  assert.equal(new Set([...first, ...second].map((item) => `${item.type}:${item.value.id}`)).size, 50);
  assert.deepEqual(
    [...first, ...second].map((item) => item.created_at),
    [...first, ...second].map((item) => item.created_at).sort().reverse(),
  );
  assert.ok(first.every((item) => item.value.content.includes("-body-")));
});

test("feed route rejects unbounded page offsets with a stable response", async () => {
  const response = GET(new Request("http://localhost/api/v1/feed?page=10001&limit=20"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "page 超出允许范围" });
});
