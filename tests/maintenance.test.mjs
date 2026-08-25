import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-maintenance-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const { db } = await import("../src/lib/db.ts");
const { runScheduledMaintenance } = await import("../src/lib/maintenance-scheduler.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

test("periodic maintenance is leased and removes only expired transient rows", () => {
  const now = Date.now();
  const old = new Date(now - 200 * 24 * 60 * 60 * 1000).toISOString();
  const recent = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
  const insert = db.prepare(`
    INSERT INTO content_interactions (target_type, target_id, kind, visitor_key, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insert.run("post", 1, "view", "old-post-view", old);
  insert.run("moment", 1, "view", "old-moment-view", old);
  insert.run("post", 1, "view", "recent-view", recent);
  insert.run("post", 1, "like", "durable-like", old);
  db.prepare("INSERT INTO login_attempts (ip, failed_count, first_failed_at, blocked_until) VALUES (?, 1, ?, 0)")
    .run("stale-attempt", now - 25 * 60 * 60 * 1000);

  assert.equal(runScheduledMaintenance(now), true);
  assert.equal(runScheduledMaintenance(now + 1_000), false);
  assert.deepEqual(
    db.prepare("SELECT kind, visitor_key FROM content_interactions ORDER BY visitor_key").all(),
    [
      { kind: "like", visitor_key: "durable-like" },
      { kind: "view", visitor_key: "recent-view" },
    ],
  );
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM login_attempts").get().count, 0);
});
