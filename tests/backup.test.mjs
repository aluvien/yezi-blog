import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-backup-"));
const mirrorRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-backup-mirror-"));
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const { createPost, db } = await import("../src/lib/db.ts");
const { runDbBackup } = await import("../src/lib/backup.ts");
const { verifyDatabaseBackup } = await import("../src/lib/backup-verification.ts");
const { runCompleteDataBackup, verifyCompleteDataBackup } = await import("../src/lib/data-backup.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.rmSync(mirrorRoot, { recursive: true, force: true });
});

test("online SQLite backup passes integrity verification and preserves recoverable content", async () => {
  const post = createPost({ title: "可恢复文章", content: "恢复演练正文", status: "published" });
  const result = await runDbBackup({ keep: 2 });

  assert.equal(result.verification.path, result.path);
  assert.ok(result.verification.sizeBytes > 0);
  assert.ok(result.verification.schemaVersion >= 1);

  const restored = new Database(result.path, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(
      restored.prepare("SELECT title, content, status FROM posts WHERE id = ?").get(post.id),
      { title: "可恢复文章", content: "恢复演练正文", status: "published" },
    );
    assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    restored.close();
  }
});

test("backup verifier rejects an unreadable artifact", () => {
  const broken = path.join(tempRoot, "broken.db");
  fs.writeFileSync(broken, "not sqlite");
  assert.throws(() => verifyDatabaseBackup(broken), /备份/);
});

test("manual backup and verification commands work against a recoverable database", () => {
  const manualRoot = path.join(tempRoot, "manual-command");
  fs.mkdirSync(manualRoot, { recursive: true });
  const commandEnvironment = { ...process.env, BLOG_DB_PATH: process.env.BLOG_DB_PATH, BACKUP_KEEP: "2" };
  const backup = spawnSync(process.execPath, ["--experimental-strip-types", path.join(projectRoot, "scripts", "backup.mts")], {
    cwd: manualRoot,
    env: commandEnvironment,
    encoding: "utf8",
  });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);

  const backupDir = path.join(manualRoot, "data", "backups");
  const files = fs.readdirSync(backupDir).filter((name) => name.endsWith(".db"));
  assert.equal(files.length, 1);

  const verification = spawnSync(process.execPath, ["--experimental-strip-types", path.join(projectRoot, "scripts", "verify-backup.mts"), path.join(backupDir, files[0])], {
    cwd: manualRoot,
    env: commandEnvironment,
    encoding: "utf8",
  });
  assert.equal(verification.status, 0, verification.stderr || verification.stdout);
  assert.match(verification.stdout, /"status": "ok"/);
});

test("manual backup honors an explicit durable backup directory", () => {
  const manualRoot = path.join(tempRoot, "manual-command-explicit");
  const backupDir = path.join(tempRoot, "durable-backups");
  fs.mkdirSync(manualRoot, { recursive: true });
  const commandEnvironment = {
    ...process.env,
    BLOG_DB_PATH: process.env.BLOG_DB_PATH,
    BLOG_BACKUP_DIR: backupDir,
    BACKUP_KEEP: "2",
  };
  const backup = spawnSync(process.execPath, ["--experimental-strip-types", path.join(projectRoot, "scripts", "backup.mts")], {
    cwd: manualRoot,
    env: commandEnvironment,
    encoding: "utf8",
  });
  assert.equal(backup.status, 0, backup.stderr || backup.stdout);
  assert.equal(fs.readdirSync(backupDir).filter((name) => name.endsWith(".db")).length, 1);
  assert.equal(fs.existsSync(path.join(manualRoot, "data", "backups")), false);
});

test("concurrent database backups are serialized and never leave orphan sidecars", async () => {
  const results = await Promise.allSettled([runDbBackup({ keep: 20 }), runDbBackup({ keep: 20 })]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  assert.match(String(results.find((item) => item.status === "rejected").reason), /已有备份任务/);
  const backupDir = path.join(tempRoot, "data", "backups");
  assert.deepEqual(fs.readdirSync(backupDir).filter((name) => /\.db-(?:wal|shm)$/.test(name)), []);
});

test("encrypted complete backup contains persistent data and only the online SQLite snapshot", async () => {
  fs.mkdirSync(path.join(tempRoot, "data", "uploads", "202608"), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, "data", "reference-archives", "entry"), { recursive: true });
  fs.writeFileSync(path.join(tempRoot, "data", "uploads", "202608", "photo.png"), "image");
  fs.writeFileSync(path.join(tempRoot, "data", "reference-archives", "entry", "reader.md"), "reader");
  fs.writeFileSync(path.join(tempRoot, "data", "qq-music-session.json"), "{\"cookie\":\"encrypted-at-rest-in-backup\"}");
  fs.writeFileSync(path.join(tempRoot, "data", "telegram-bot-state.json"), "{\"offset\":42}");
  process.env.DATA_BACKUP_KEY = Buffer.alloc(32, 7).toString("base64");
  process.env.DATA_BACKUP_MIRROR_DIR = mirrorRoot;

  const result = await runCompleteDataBackup({ keep: 2 });
  const checked = await verifyCompleteDataBackup(result.path);
  assert.ok(result.mirroredPath?.startsWith(mirrorRoot));
  assert.equal(fs.readFileSync(result.mirroredPath).equals(fs.readFileSync(result.path)), true);
  assert.deepEqual(checked.entries, [
    "data/blog.db",
    "data/qq-music-session.json",
    "data/reference-archives/entry/reader.md",
    "data/telegram-bot-state.json",
    "data/uploads/202608/photo.png",
  ]);
  assert.equal(checked.entries.some((name) => /blog\.db-(?:wal|shm)$/.test(name)), false);
});
