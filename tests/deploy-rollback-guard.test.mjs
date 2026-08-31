import assert from "node:assert/strict";
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { databaseSnapshotsMatch } from "../scripts/deploy-rollback-guard.mjs";

async function snapshot(databasePath, target) {
  const database = new Database(databasePath, { readonly: true });
  try {
    await database.backup(target);
  } finally {
    database.close();
  }
}

test("rollback guard compares consistent SQLite backups, including WAL-only writes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-deploy-rollback-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "blog.db");
  const before = path.join(root, "before.db");
  const unchanged = path.join(root, "unchanged.db");
  const changed = path.join(root, "changed.db");
  const writer = new Database(databasePath);

  try {
    assert.equal(writer.pragma("journal_mode = WAL", { simple: true }), "wal");
    writer.exec("CREATE TABLE entries (value TEXT NOT NULL)");
    writer.prepare("INSERT INTO entries (value) VALUES (?)").run("before");
    await snapshot(databasePath, before);
    await snapshot(databasePath, unchanged);
    assert.equal(await databaseSnapshotsMatch(before, unchanged), true);

    // This commit is kept in blog.db-wal while the writer remains open.
    writer.prepare("INSERT INTO entries (value) VALUES (?)").run("after");
    assert.equal(fs.existsSync(`${databasePath}-wal`), true);
    await snapshot(databasePath, changed);
    assert.equal(await databaseSnapshotsMatch(before, changed), false);
  } finally {
    writer.close();
  }
});
