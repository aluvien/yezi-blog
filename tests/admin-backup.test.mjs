import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-admin-backup-"));
const external = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-admin-backup-external-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.BLOG_ENV_FILE = path.join(external, "blog.env");
process.env.QQ_MUSIC_SESSION_PATH = path.join(external, "session.json");
process.env.ADMIN_PASSWORD = "backup-private-password";
process.env.HOST_ONLY_SECRET = "must-not-export";
process.env.DATA_BACKUP_KEY = ""; // Manual backups must work without encryption setup.
const { db, createPost } = await import("../src/lib/db.ts");
const { executeAdminBackup, getAdminBackupStatus, startAdminBackup, getAdminBackupDownload, verifyAdminBackupArchive } = await import("../src/lib/admin-backup.ts");

const backupRoot = path.join(root, "data", "backups", "admin");
test.after(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(external, { recursive: true, force: true });
});

function extract(archive) {
  const target = fs.mkdtempSync(path.join(root, "extracted-"));
  const result = spawnSync("tar", ["-xzf", archive, "-C", target]);
  assert.equal(result.status, 0, result.stderr.toString());
  return target;
}

function fixtures() {
  fs.mkdirSync(path.join(root, "data", "uploads"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "reference-archives"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "qq-music-audio"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "uploads", "photo.png"), "image-original");
  fs.writeFileSync(path.join(root, "data", "reference-archives", "reader.md"), "reference");
  fs.writeFileSync(path.join(root, "data", "qq-music-audio", "song.m4a"), "cache");
  fs.writeFileSync(path.join(root, "data", "upload.tmp"), "temporary");
  fs.writeFileSync(path.join(root, ".env.local"), "ADMIN_PASSWORD=original-file-password\n");
  fs.writeFileSync(path.join(root, "ecosystem.config.js"), "module.exports = { apps: [] };\n");
  fs.writeFileSync(process.env.BLOG_ENV_FILE, "PRIVATE_KEY=external-file-secret\n");
  fs.writeFileSync(process.env.QQ_MUSIC_SESSION_PATH, '{"cookie":"private-cookie"}');
}

test("one-click backup is recoverable with committed WAL rows, files and actual app configuration", async () => {
  fixtures();
  db.pragma("wal_autocheckpoint = 0");
  const post = createPost({ title: "完整备份恢复", content: "WAL 中已提交的内容", status: "published" });
  assert.ok(fs.statSync(`${process.env.BLOG_DB_PATH}-wal`).size > 0);
  const started = startAdminBackup();
  assert.equal(started.started, true);
  const duplicate = startAdminBackup();
  assert.equal(duplicate.started, false);
  assert.equal(duplicate.status.id, started.status.id);
  assert.equal(getAdminBackupDownload(started.status.id), null);
  const phases = new Set();
  const poller = setInterval(() => phases.add(getAdminBackupStatus()?.phase), 1);
  try { await executeAdminBackup(started.status.id); } finally { clearInterval(poller); }
  const status = getAdminBackupStatus();
  assert.equal(status.status, "completed", status.error);
  assert.equal(status.phase, "complete");
  assert.ok(phases.has("files") || phases.has("config") || phases.has("verify"));
  assert.equal(JSON.stringify(status).includes("password"), false);
  assert.equal(JSON.stringify(status).includes(root), false);
  assert.equal(JSON.stringify(status).includes("cookie"), false);
  const artifact = getAdminBackupDownload(status.id);
  assert.ok(artifact);
  assert.equal(fs.statSync(artifact.path).mode & 0o777, 0o600);
  assert.equal(fs.statSync(backupRoot).mode & 0o777, 0o700);
  const restored = extract(artifact.path);
  const database = new Database(path.join(restored, "data", "blog.db"), { readonly: true });
  try {
    assert.equal(database.prepare("SELECT content FROM posts WHERE id = ?").get(post.id).content, "WAL 中已提交的内容");
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  } finally { database.close(); }
  assert.equal(fs.readFileSync(path.join(restored, "data", "uploads", "photo.png"), "utf8"), "image-original");
  assert.equal(fs.readFileSync(path.join(restored, "config", "project", ".env.local"), "utf8"), "ADMIN_PASSWORD=original-file-password\n");
  assert.equal(fs.readFileSync(path.join(restored, "config", "external.env"), "utf8"), "PRIVATE_KEY=external-file-secret\n");
  assert.equal(fs.readFileSync(path.join(restored, "data", "qq-music-session.json"), "utf8"), '{"cookie":"private-cookie"}');
  const env = fs.readFileSync(path.join(restored, "config", "runtime.env"), "utf8");
  assert.match(env, /backup-private-password/);
  assert.equal(env.includes("must-not-export"), false);
  assert.equal(fs.existsSync(path.join(restored, "data", "backups")), false);
  assert.equal(fs.existsSync(path.join(restored, "data", "qq-music-audio")), false);
  assert.equal(fs.existsSync(path.join(restored, "data", "upload.tmp")), false);
  const manifest = JSON.parse(fs.readFileSync(path.join(restored, "manifest.json"), "utf8"));
  assert.ok(manifest.files.some((entry) => entry.path === "config/project/ecosystem.config.js"));
  assert.ok(manifest.files.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256)));
  assert.equal(manifest.files.some((entry) => /blog\.db-(wal|shm)$/.test(entry.path)), false);
  assert.match(fs.readFileSync(path.join(restored, "RESTORE.md"), "utf8"), /0600/);
  assert.equal(db.prepare("SELECT content FROM posts WHERE id = ?").get(post.id).content, "WAL 中已提交的内容");
  assert.equal(getAdminBackupDownload("../../.env.local"), null);
  assert.equal(getAdminBackupDownload("00000000-0000-4000-8000-000000000000"), null);
});

test("verification rejects modified file contents even in a valid gzip archive", async () => {
  const artifact = getAdminBackupDownload(getAdminBackupStatus().id);
  const restored = extract(artifact.path);
  fs.writeFileSync(path.join(restored, "data", "uploads", "photo.png"), "tampered");
  const damaged = path.join(root, "damaged.tar.gz");
  assert.equal(spawnSync("tar", ["-czf", damaged, "-C", restored, "manifest.json", "RESTORE.md", "data", "config"]).status, 0);
  const target = fs.mkdtempSync(path.join(root, "verify-"));
  await assert.rejects(verifyAdminBackupArchive(damaged, target), /校验失败/);
});

test("a dead process leaves an interrupted status and can be retried without touching live data", async () => {
  const first = startAdminBackup();
  // Use a stale same-process boot identity, avoiding dependence on a guessed OS PID.
  fs.writeFileSync(path.join(backupRoot, ".lock"), JSON.stringify({ id: first.status.id, pid: process.pid, bootId: "previous-process" }));
  fs.mkdirSync(path.join(backupRoot, `.stage-${first.status.id}`));
  assert.equal(getAdminBackupStatus().status, "failed");
  assert.match(getAdminBackupStatus().error, /中断/);
  assert.equal(fs.existsSync(path.join(backupRoot, `.stage-${first.status.id}`)), false);
  const retry = startAdminBackup();
  assert.equal(retry.started, true);
  await executeAdminBackup(retry.status.id);
  assert.equal(getAdminBackupStatus().status, "completed");
});

test("missing configured env file fails without exposing its path and cleans temporary secrets", async () => {
  fs.unlinkSync(process.env.BLOG_ENV_FILE);
  const task = startAdminBackup();
  await executeAdminBackup(task.status.id);
  const failed = getAdminBackupStatus();
  assert.equal(failed.status, "failed");
  assert.equal(failed.phase, "config");
  assert.equal(JSON.stringify(failed).includes(external), false);
  assert.equal(getAdminBackupDownload(task.status.id), null);
  assert.equal(fs.existsSync(path.join(backupRoot, ".lock")), false);
  assert.equal(fs.readdirSync(backupRoot).some((name) => name.startsWith(".stage") || name.endsWith(".tmp")), false);
  fixtures();
  const retry = startAdminBackup();
  await executeAdminBackup(retry.status.id);
  assert.equal(getAdminBackupStatus().status, "completed");
});

test("backup rejects data symlinks outside the state root", async () => {
  fs.symlinkSync(process.env.BLOG_ENV_FILE, path.join(root, "data", "private-link"));
  const task = startAdminBackup();
  await executeAdminBackup(task.status.id);
  assert.equal(getAdminBackupStatus().status, "failed");
  assert.equal(getAdminBackupStatus().phase, "files");
  assert.equal(getAdminBackupDownload(task.status.id), null);
  fs.unlinkSync(path.join(root, "data", "private-link"));
});
