import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-local-backups-"));
const external = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-local-backups-external-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
delete process.env.BLOG_BACKUP_DIR;
const { db } = await import("../src/lib/db.ts");
const { listLocalBackups, openLocalBackupDownload, deleteLocalBackup, LocalBackupError } = await import("../src/lib/local-backups.ts");
const { startAdminBackup, getAdminBackupStatus, withAdminBackupMaintenanceLock } = await import("../src/lib/admin-backup.ts");
const { acquireCloudLock, releaseCloudLock, writeCloudTask, getCloudTask } = await import("../src/lib/cloud-backup.ts");
const backups = path.join(root, "data", "backups");
const adminName = `${crypto.randomUUID()}.tar.gz`;
const databaseName = "blog-20261008010203123-a1234567.db";
const dataName = "data-20261008010203123-a1234567.tar.gz.enc";
const restoreName = `rollback-${crypto.randomUUID()}.tar.gz`;
function put(kind, name, content = "backup") {
  const directory = kind === "admin" ? path.join(backups, "admin") : kind === "restore" ? path.join(backups, "cloud") : kind === "database" && process.env.BLOG_BACKUP_DIR ? external : backups;
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  fs.writeFileSync(file, content);
  return file;
}
function expectError(run, status) {
  assert.throws(run, error => error instanceof LocalBackupError && error.status === status);
}
test.beforeEach(() => {
  fs.rmSync(backups, { recursive: true, force: true });
  delete process.env.BLOG_BACKUP_DIR;
});
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(external, { recursive: true, force: true }); });

test("catalog reports all four completed backup types, sizes and newest-first order", () => {
  const names = [["admin", adminName], ["database", databaseName], ["data", dataName], ["restore", restoreName]];
  names.forEach(([kind, name], index) => {
    const file = put(kind, name, "x".repeat(index + 1));
    fs.utimesSync(file, new Date(1000 * index), new Date(1000 * index));
  });
  const list = listLocalBackups();
  assert.equal(list.count, 4); assert.equal(list.totalBytes, 10); assert.equal(list.busy, false);
  assert.deepEqual(list.files.map(file => file.kind), ["restore", "data", "database", "admin"]);
  assert.equal(list.files.find(file => file.kind === "data").encrypted, true);
  assert.ok(!JSON.stringify(list).includes(root));
});

test("catalog excludes temporary files, live data, symlinks, hardlinks and empty files", () => {
  put("admin", `${adminName}.tmp`);
  put("database", "blog.db"); put("database", `${databaseName}-wal`);
  const target = path.join(root, ".env.local"); fs.writeFileSync(target, "private-settings");
  fs.mkdirSync(path.join(backups, "admin"), { recursive: true });
  fs.symlinkSync(target, path.join(backups, "admin", adminName));
  fs.linkSync(target, path.join(backups, databaseName));
  put("data", dataName, "");
  assert.equal(listLocalBackups().count, 0);
  expectError(() => deleteLocalBackup("admin", adminName), 404);
  expectError(() => openLocalBackupDownload("database", databaseName), 404);
  assert.equal(fs.readFileSync(target, "utf8"), "private-settings");
  assert.ok(fs.existsSync(process.env.BLOG_DB_PATH));
});

test("historical archive downloads remain usable without the latest task status", () => {
  put("admin", adminName, "historical-archive");
  const file = openLocalBackupDownload("admin", adminName);
  try { assert.equal(fs.readFileSync(file.fd, "utf8"), "historical-archive"); assert.equal(file.size, 18); assert.equal(file.type, "application/gzip"); }
  finally { fs.closeSync(file.fd); }
  expectError(() => openLocalBackupDownload("admin", "../../.env.local"), 400);
  expectError(() => deleteLocalBackup("unknown", adminName), 400);
  expectError(() => deleteLocalBackup("admin", "../../.env.local"), 400);
});

test("deleting the latest archive clears its status while preserving older downloads", () => {
  const oldName = `${crypto.randomUUID()}.tar.gz`;
  put("admin", oldName); put("admin", adminName);
  fs.writeFileSync(path.join(backups, "admin", "status.json"), JSON.stringify({ id: adminName.slice(0, -7), status: "completed", phase: "complete" }));
  deleteLocalBackup("admin", adminName);
  assert.equal(getAdminBackupStatus(), null);
  assert.deepEqual(listLocalBackups().files.map(file => file.name), [oldName]);
  const file = openLocalBackupDownload("admin", oldName); fs.closeSync(file.fd);
  expectError(() => deleteLocalBackup("admin", adminName), 404);
});

test("deletion respects cloud, manual, daily producer locks and restore protection", () => {
  const file = put("admin", adminName);
  const id = crypto.randomUUID(); acquireCloudLock(id);
  try { assert.equal(listLocalBackups().busy, true); expectError(() => deleteLocalBackup("admin", adminName), 409); }
  finally { releaseCloudLock(id); }
  withAdminBackupMaintenanceLock(() => expectError(() => deleteLocalBackup("admin", adminName), 409));
  for (const name of [".data-backup.lock", ".backup.lock"]) {
    const lock = path.join(backups, name); fs.writeFileSync(lock, "");
    assert.equal(listLocalBackups().busy, true); expectError(() => deleteLocalBackup("admin", adminName), 409);
    assert.ok(fs.existsSync(lock)); fs.unlinkSync(lock);
  }
  const journal = path.join(backups, "cloud", "restore-journal.json"); fs.writeFileSync(journal, "{}");
  assert.equal(listLocalBackups().busy, true); expectError(() => deleteLocalBackup("admin", adminName), 409);
  assert.ok(fs.existsSync(file)); fs.unlinkSync(journal);
  assert.equal(listLocalBackups().busy, false);
  deleteLocalBackup("admin", adminName);
});

test("an archive being produced is hidden and cannot be downloaded or deleted", () => {
  const started = startAdminBackup();
  const name = `${started.status.id}.tar.gz`; put("admin", name);
  assert.equal(listLocalBackups().count, 0); assert.equal(listLocalBackups().busy, true);
  expectError(() => openLocalBackupDownload("admin", name), 404);
  expectError(() => deleteLocalBackup("admin", name), 409);
});

test("configured database directory is managed while mirrors and unrelated files are preserved", () => {
  process.env.BLOG_BACKUP_DIR = external;
  const file = put("database", databaseName, "snapshot");
  const mirror = path.join(external, dataName); fs.writeFileSync(mirror, "mirror");
  assert.equal(listLocalBackups().count, 1);
  deleteLocalBackup("database", databaseName);
  assert.equal(fs.existsSync(file), false); assert.equal(fs.readFileSync(mirror, "utf8"), "mirror");
  assert.equal(listLocalBackups().count, 0);
});

test("deleting a recovery safety archive removes the stale task reference", () => {
  put("restore", restoreName);
  writeCloudTask({ id: crypto.randomUUID(), kind: "restore", status: "completed", phase: "complete", safetyBackup: restoreName });
  deleteLocalBackup("restore", restoreName);
  assert.equal(getCloudTask().safetyBackup, undefined); assert.equal(listLocalBackups().count, 0);
});


test("database snapshots from older releases are also listed and manageable", () => {
  const name = "blog-20261007020304.db";
  const archive = put("database", name, "legacy-snapshot");
  assert.equal(listLocalBackups().files[0].name, name);
  const file = openLocalBackupDownload("database", name);
  try { assert.equal(fs.readFileSync(file.fd, "utf8"), "legacy-snapshot"); }
  finally { fs.closeSync(file.fd); }
  deleteLocalBackup("database", name);
  assert.equal(fs.existsSync(archive), false); assert.equal(listLocalBackups().count, 0);
});
