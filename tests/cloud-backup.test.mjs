import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import * as tar from "tar";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-cloud-test-"));
const external = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-cloud-test-external-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "custom.db");
process.env.QQ_MUSIC_SESSION_PATH = path.join(external, "qq.json");
process.env.ADMIN_PASSWORD = "cloud-admin-private";
const { db, createPost, createSession, getSessionByToken } = await import("../src/lib/db.ts");
const { cloudBackupRoot, saveCloudSettings, publicCloudSettings, readCloudSettings } = await import("../src/lib/cloud-backup-config.ts");
const { WebDavClient, normalizeWebDavLocation, parseDavResponses } = await import("../src/lib/webdav.ts");
const { encryptCloudArchive, decryptCloudArchive, extractAndVerifyCloudArchive } = await import("../src/lib/cloud-backup-archive.ts");
const { startCloudTask, executeCloudTask, getCloudTask, cloudStage, preparedCloudDownload, writeCloudTask } = await import("../src/lib/cloud-backup.ts");
const { applyCloudRestore, recoverInterruptedCloudRestore } = await import("../src/lib/cloud-backup-restore.ts");
const { cloudRestoreGuardPath, isCloudRestoreActive } = await import("../src/lib/cloud-restore-guard.ts");
const { runDbBackup } = await import("../src/lib/backup.ts");
const remote = new Map();
let corruptDownloads = false;
let deleteDenied = false;
let selectiveRequests = 0;
const basic = `Basic ${Buffer.from("test-user:test-password").toString("base64")}`;
const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== basic) { response.writeHead(401); response.end(); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const url = new URL(request.url, "http://localhost");
  if (request.method === "PROPFIND") {
    if (!body.toString().includes("allprop")) { selectiveRequests++; response.writeHead(404); response.end(); return; }
    if (url.pathname !== "/dav/backup/") { response.writeHead(404); response.end(); return; }
    let entries = '<D:response><D:href>/dav/backup/</D:href><D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
    if (request.headers.depth === "1") {
      for (const [name, content] of remote) entries += `<D:response><D:href>/dav/backup/${name}</D:href><D:propstat><D:prop><D:resourcetype/><D:getcontentlength>${content.length}</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
      entries += '<D:response><D:href>https://evil.example/dav/backup/yezi-complete-20261007T000000Z-00000000-0000-4000-8000-000000000000.tar.gz.enc</D:href><D:propstat><D:prop><D:getcontentlength>1</D:getcontentlength></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>';
    }
    response.writeHead(207, { "Content-Type": "application/xml" }); response.end(`<D:multistatus xmlns:D="DAV:">${entries}</D:multistatus>`); return;
  }
  const name = decodeURIComponent(url.pathname.slice("/dav/backup/".length));
  if (request.method === "PUT") {
    if (remote.has(name) && request.headers["if-none-match"] === "*") { response.writeHead(412); response.end(); return; }
    remote.set(name, body); response.writeHead(201); response.end(); return;
  }
  if (request.method === "GET") {
    if (!remote.has(name)) { response.writeHead(404); response.end(); return; }
    const data = Buffer.from(remote.get(name)); if (corruptDownloads) data[data.length - 1] ^= 1;
    response.writeHead(200, { "Content-Length": data.length }); response.end(data); return;
  }
  if (request.method === "DELETE") {
    if (deleteDenied) { response.writeHead(403); response.end(); return; }
    remote.delete(name); response.writeHead(204); response.end(); return;
  }
  response.writeHead(405); response.end();
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}/dav/`;
const settings = { endpoint, directory: "backup", username: "test-user", password: "test-password", dailyEnabled: false, keep: 2 };
let selected;
let originalPost;
test.after(async () => {
  db.close(); await new Promise(resolve => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(external, { recursive: true, force: true });
});

test("custom settings preserve credentials privately, reject credential redirects and retain exported recovery keys", () => {
  assert.equal(publicCloudSettings().hasPassword, false);
  saveCloudSettings(settings);
  const publicSettings = publicCloudSettings();
  assert.equal(publicSettings.endpoint, endpoint);
  assert.equal(publicSettings.hasPassword, true);
  assert.equal(JSON.stringify(publicSettings).includes("test-password"), false);
  assert.equal("key" in publicSettings, false);
  assert.equal(fs.statSync(path.join(cloudBackupRoot(), "settings.json")).mode & 0o777, 0o600);
  assert.equal(fs.statSync(cloudBackupRoot()).mode & 0o777, 0o700);
  const key = readCloudSettings().key;
  saveCloudSettings({ ...settings, password: "", keep: 3 });
  assert.equal(readCloudSettings().password, "test-password"); assert.equal(readCloudSettings().key, key);
  assert.throws(() => saveCloudSettings({ ...settings, password: "", username: "another" }), /重新填写密码/);
  assert.throws(() => normalizeWebDavLocation("https://user:secret@example.com", "backup"));
  assert.throws(() => normalizeWebDavLocation(endpoint, "../outside"));
  assert.throws(() => parseDavResponses('<!DOCTYPE foo [<!ENTITY x SYSTEM "file:///etc/passwd">]><foo>&x;</foo>'));
  saveCloudSettings(settings);
});

test("WebDAV connection test uses fnOS-compatible allprop and checks write, read, listing and cleanup", async () => {
  const client = new WebDavClient(readCloudSettings());
  await client.test(cloudBackupRoot());
  assert.equal(remote.size, 0); assert.equal(selectiveRequests, 0);
  remote.set("unrelated-personal-file.txt", Buffer.from("do not delete"));
  assert.deepEqual(await client.list(), []);
  deleteDenied = true;
  await assert.rejects(client.test(cloudBackupRoot()), /DELETE.*403/);
  deleteDenied = false;
  for (const name of remote.keys()) if (name.startsWith(".yezi-connection-")) remote.delete(name);
});

test("cloud backups include WAL data, files and config, are encrypted, and round-trip failures preserve older backups", async () => {
  fs.mkdirSync(path.join(root, "data", "uploads"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "uploads", "photo.jpg"), "original-photo");
  fs.writeFileSync(path.join(root, ".env.local"), "ADMIN_PASSWORD=backup-env-private\nPM2_HOME=/custom-host-pm2\n", { mode: 0o600 });
  fs.writeFileSync(process.env.QQ_MUSIC_SESSION_PATH, '{"cookie":"original-cookie"}', { mode: 0o600 });
  db.pragma("wal_autocheckpoint = 0");
  originalPost = createPost({ title: "云备份文章", content: "已提交 WAL 内容", status: "published" });
  const started = startCloudTask("backup");
  assert.equal(startCloudTask("backup").started, false);
  await executeCloudTask(started.task.id);
  const task = getCloudTask(); assert.equal(task.status, "completed", task.error);
  selected = task.name;
  assert.ok(remote.has(selected));
  assert.equal(remote.get(selected).subarray(0, 10).toString(), "YEZICLOUD1");
  assert.equal(remote.get(selected).includes(Buffer.from("backup-env-private")), false);
  assert.equal(fs.existsSync(cloudStage(task.id)), false);
  corruptDownloads = true;
  const corrupt = startCloudTask("backup"); await executeCloudTask(corrupt.task.id);
  corruptDownloads = false;
  assert.equal(getCloudTask().status, "failed");
  assert.deepEqual((await new WebDavClient(readCloudSettings()).list()).map(file => file.name), [selected]);
  assert.equal(remote.get("unrelated-personal-file.txt").toString(), "do not delete");
});

test("encrypted backup authentication completes before extraction and unsafe tar links are rejected", async () => {
  const source = path.join(root, "remote.enc"); fs.writeFileSync(source, remote.get(selected));
  const plaintext = path.join(root, "remote.tar.gz");
  await decryptCloudArchive(source, plaintext, readCloudSettings().key);
  const verified = await extractAndVerifyCloudArchive(plaintext, path.join(root, "verified"));
  assert.ok(verified.files.some(file => file.path === "config/runtime.env"));
  const altered = Buffer.from(remote.get(selected)); altered[altered.length - 1] ^= 1;
  fs.writeFileSync(path.join(root, "corrupt.enc"), altered);
  await assert.rejects(decryptCloudArchive(path.join(root, "corrupt.enc"), path.join(root, "corrupt.tar.gz"), readCloudSettings().key), /密钥不匹配/);
  assert.equal(fs.existsSync(path.join(root, "corrupt.tar.gz")), false);
  await assert.rejects(decryptCloudArchive(source, path.join(root, "wrong-key.tar.gz"), crypto.randomBytes(32).toString("base64")), /密钥不匹配/);
  const malicious = path.join(root, "malicious"); fs.mkdirSync(malicious); fs.symlinkSync("../../outside", path.join(malicious, "data"));
  const archive = path.join(root, "malicious.tar.gz"); await tar.c({ file: archive, cwd: malicious, gzip: true }, ["data"]);
  await assert.rejects(extractAndVerifyCloudArchive(archive, path.join(root, "unsafe-output")), /不安全路径/);
  assert.equal(fs.existsSync(path.join(root, "unsafe-output")), false);
  const reencrypted = path.join(root, "reencrypted.enc"); await encryptCloudArchive(plaintext, reencrypted, readCloudSettings().key);
  assert.notDeepEqual(fs.readFileSync(source), fs.readFileSync(reencrypted));
});

test("restore preview validates all files, then restores into the live WAL database without losing host configuration", async () => {
  createPost({ title: "备份后新增文章", content: "应在恢复前备份保留", status: "draft" });
  fs.writeFileSync(path.join(root, "data", "uploads", "photo.jpg"), "changed-photo");
  fs.writeFileSync(path.join(root, "data", "uploads", "later.jpg"), "later-photo");
  fs.writeFileSync(process.env.QQ_MUSIC_SESSION_PATH, '{"cookie":"changed-cookie"}');
  fs.writeFileSync(path.join(root, ".env.local"), "ADMIN_PASSWORD=host-current\nPM2_HOME=/host-current\n");
  fs.writeFileSync(path.join(root, "data", "deploy-commit"), "current-host-commit");
  const session = crypto.randomBytes(32).toString("hex");
  createSession(session, Date.now() + 60_000);
  const prepared = startCloudTask("prepare", selected); await executeCloudTask(prepared.task.id);
  const task = getCloudTask(); assert.equal(task.status, "completed", task.error); assert.equal(task.phase, "ready");
  assert.equal(task.preview.posts, 1); assert.ok(preparedCloudDownload(task.id).size > 0);
  await assert.rejects(applyCloudRestore(task.id, ""), /确认覆盖/);
  const result = await applyCloudRestore(task.id, "恢复数据");
  assert.equal(result.phase, "complete");
  assert.equal(db.prepare("SELECT count(*) AS count FROM posts").get().count, 1);
  assert.equal(db.prepare("SELECT content FROM posts WHERE id = ?").get(originalPost.id).content, "已提交 WAL 内容");
  assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(fs.readFileSync(path.join(root, "data", "uploads", "photo.jpg"), "utf8"), "original-photo");
  assert.equal(fs.existsSync(path.join(root, "data", "uploads", "later.jpg")), false);
  assert.equal(fs.readFileSync(process.env.QQ_MUSIC_SESSION_PATH, "utf8"), '{"cookie":"original-cookie"}');
  assert.equal(fs.readFileSync(path.join(root, ".env.local"), "utf8"), "ADMIN_PASSWORD=host-current\nPM2_HOME=/host-current\n");
  assert.equal(fs.readFileSync(path.join(root, "data", "deploy-commit"), "utf8"), "current-host-commit");
  assert.ok(fs.existsSync(path.join(cloudBackupRoot(), result.safetyBackup)));
  assert.equal(isCloudRestoreActive(), false);
  assert.equal(fs.existsSync(cloudStage(task.id)), false);
  assert.equal(Boolean(getSessionByToken(session)), false);
  // The SAME open singleton connection must continue to support writes after the online restore.
  createPost({ title: "恢复后可写", content: "正常", status: "draft" });
  assert.equal(db.prepare("SELECT count(*) AS count FROM posts").get().count, 2);
});

test("restart rolls an interrupted database/file switch back before releasing the restore guard", async () => {
  const id = crypto.randomUUID();
  const stage = cloudStage(id); fs.mkdirSync(stage, { mode: 0o700 });
  const before = await runDbBackup({ backupDir: path.join(stage, "rollback-db") });
  const target = path.join(root, "data", "uploads");
  const old = `${target}.yezi-${id}.old`; const next = `${target}.yezi-${id}.new`;
  fs.renameSync(target, old); fs.mkdirSync(target); fs.writeFileSync(path.join(target, "wrong.jpg"), "interrupted");
  db.prepare("DELETE FROM posts").run();
  const journal = { id, dbPath: process.env.BLOG_DB_PATH, rollbackDb: before.path, committed: false, moves: [{ target, old, next, hadOriginal: true }] };
  fs.writeFileSync(path.join(cloudBackupRoot(), "restore-journal.json"), JSON.stringify(journal), { mode: 0o600 });
  fs.writeFileSync(cloudRestoreGuardPath(), id, { mode: 0o600 });
  writeCloudTask({ id, kind: "prepare", status: "running", phase: "restore", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await recoverInterruptedCloudRestore();
  assert.equal(db.prepare("SELECT count(*) AS count FROM posts").get().count, 2);
  assert.equal(fs.readFileSync(path.join(target, "photo.jpg"), "utf8"), "original-photo");
  assert.equal(fs.existsSync(path.join(target, "wrong.jpg")), false);
  assert.equal(isCloudRestoreActive(), false);
  assert.match(getCloudTask().error, /已回滚/);
});


test("retention permission failures keep the new verified backup and report a cleanup warning", async () => {
  saveCloudSettings({ ...settings, keep: 1 });
  deleteDenied = true;
  const task = startCloudTask("backup");
  try { await executeCloudTask(task.task.id); } finally { deleteDenied = false; }
  const completed = getCloudTask();
  assert.equal(completed.status, "completed", completed.error);
  assert.match(completed.warning, /旧备份清理未完成/);
  assert.ok(remote.has(completed.name));
  assert.ok(remote.has(selected));
});


test("an upload accepted before restoration cannot create a record after the data epoch changes", async () => {
  const { writeUploadWithRecord } = await import("../src/lib/upload-storage.ts");
  const file = path.join(root, "data", "uploads", "in-flight.jpg");
  let recorded = false;
  const pending = writeUploadWithRecord(file, Buffer.from("incoming"), () => { recorded = true; });
  fs.writeFileSync(path.join(cloudBackupRoot(), "restore-epoch"), crypto.randomUUID(), { mode: 0o600 });
  await assert.rejects(pending, /恢复流程/);
  assert.equal(recorded, false);
  assert.equal(fs.existsSync(file), false);
});
