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
process.env.NEXT_PUBLIC_SITE_URL = "https://blog.yezi.me";
const { db, createPost, createSession, getSessionByToken } = await import("../src/lib/db.ts");
const { cloudBackupRoot, saveCloudSettings, publicCloudSettings, readCloudSettings } = await import("../src/lib/cloud-backup-config.ts");
const { CLOUD_FILE_PATTERN, WebDavClient, normalizeWebDavLocation, parseDavResponses } = await import("../src/lib/webdav.ts");
const { cloudBackupSiteLabel } = await import("../src/lib/cloud-backup-name.ts");
const { encryptCloudArchive, decryptCloudArchive, extractAndVerifyCloudArchive } = await import("../src/lib/cloud-backup-archive.ts");
const { acquireCloudLock, releaseCloudLock, isCloudBusy, downloadCloudBackup, deleteCloudBackup, startCloudTask, executeCloudTask, getCloudTask, cloudStage, preparedCloudDownload, writeCloudTask } = await import("../src/lib/cloud-backup.ts");
const { applyCloudRestore, recoverInterruptedCloudRestore } = await import("../src/lib/cloud-backup-restore.ts");
const { cloudRestoreGuardPath, isCloudRestoreActive } = await import("../src/lib/cloud-restore-guard.ts");
const { runDbBackup } = await import("../src/lib/backup.ts");
const remote = new Map();
let corruptDownloads = false;
let deleteDenied = false;
let selectiveRequests = 0;
let uploadDelayMs = 0;
let uploadStatus = 201;
let pauseUpload = null;
const basic = `Basic ${Buffer.from("test-user:test-password").toString("base64")}`;
const server = http.createServer(async (request, response) => {
  if (request.headers.authorization !== basic) { response.writeHead(401); response.end(); return; }
  if (request.method === "PUT" && pauseUpload) await pauseUpload;
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
    if (uploadStatus !== 201) { response.writeHead(uploadStatus); response.end(); return; }
    remote.set(name, body);
    if (uploadDelayMs) await new Promise(resolve => setTimeout(resolve, uploadDelayMs));
    response.writeHead(201); response.end(); return;
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
  assert.match(selected, /-blog\.yezi\.me-/);
  assert.ok(remote.has(selected));
  assert.equal(task.transfer.totalBytes, remote.get(selected).length);
  assert.equal(task.transfer.transferredBytes, task.transfer.totalBytes);
  assert.ok(task.transfer.bytesPerSecond > 0);
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
  const lateBotState = path.join(root, "data", "telegram-bot-state.json");
  fs.writeFileSync(lateBotState, '{"offset":12345}');
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
  assert.equal(fs.existsSync(lateBotState), false, "state created after the backup must not survive restoration");
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


test("backup names distinguish domain, IPv4, IPv6 and ports, without paths or credentials", () => {
  assert.equal(cloudBackupSiteLabel("https://user:secret@blog.yezi.me/path?q=secret"), "blog.yezi.me");
  assert.equal(cloudBackupSiteLabel("http://192.0.2.1:3030"), "192.0.2.1-3030");
  assert.equal(cloudBackupSiteLabel("http://[2001:db8::1]:3030"), "2001-db8--1--3030");
  assert.equal(cloudBackupSiteLabel("invalid", "my-server"), "my-server");
  assert.equal(cloudBackupSiteLabel("file:///secret", "my-server"), "my-server");
  const longLabel = cloudBackupSiteLabel("invalid", "a".repeat(200));
  assert.equal(longLabel.length, 100);
  assert.notEqual(longLabel, cloudBackupSiteLabel("invalid", "a".repeat(199) + "b"));
  assert.equal(cloudBackupSiteLabel("", "???"), "unknown-host");
});

test("shared-directory retention preserves other websites and legacy backups", async () => {
  const foreign = `yezi-complete-20261007T000000Z-other.example-${crypto.randomUUID()}.tar.gz.enc`;
  const legacy = `yezi-complete-20261007T000000Z-${crypto.randomUUID()}.tar.gz.enc`;
  remote.set(foreign, Buffer.from("other website")); remote.set(legacy, Buffer.from("legacy"));
  const task = startCloudTask("backup"); await executeCloudTask(task.task.id);
  const completed = getCloudTask(); assert.equal(completed.status, "completed", completed.error);
  const files = await new WebDavClient(readCloudSettings()).list();
  assert.equal(files.filter(file => file.site === "blog.yezi.me").length, 1);
  assert.equal(files.find(file => file.name === foreign).site, "other.example");
  assert.equal(files.find(file => file.name === legacy).site, undefined);
  assert.equal(CLOUD_FILE_PATTERN.test(legacy), true);
  assert.equal(remote.has(selected), false);
  assert.equal(remote.get("unrelated-personal-file.txt").toString(), "do not delete");
});

test("manual deletion rejects non-backup paths and busy tasks, and preserves files on DAV denial", async () => {
  const client = new WebDavClient(readCloudSettings());
  const files = await client.list();
  const target = files.find(file => file.site === "blog.yezi.me").name;
  for (const name of ["../" + target, "unrelated-personal-file.txt", "https://evil.example/" + target]) await assert.rejects(deleteCloudBackup(name), /有效的云备份/);
  const lock = crypto.randomUUID(); acquireCloudLock(lock);
  try { await assert.rejects(deleteCloudBackup(target), /另一个云备份/); } finally { releaseCloudLock(lock); }
  fs.writeFileSync(path.join(cloudBackupRoot(), "restore-journal.json"), "{}", { mode: 0o600 });
  try { await assert.rejects(deleteCloudBackup(target), /回滚/); } finally { fs.rmSync(path.join(cloudBackupRoot(), "restore-journal.json")); }
  assert.equal(isCloudBusy(), false);
  deleteDenied = true;
  try { await assert.rejects(deleteCloudBackup(target), /DELETE.*403/); } finally { deleteDenied = false; }
  assert.equal(remote.has(target), true); assert.equal(isCloudBusy(), false);
  await deleteCloudBackup(target);
  assert.equal(remote.has(target), false);
  for (const file of files.filter(file => file.name !== target)) assert.equal(remote.has(file.name), true);
  await assert.rejects(deleteCloudBackup(target), /不存在/);
  assert.equal(isCloudBusy(), false);
});

test("deleting a prepared legacy backup invalidates its local restore preview", async () => {
  const name = (await new WebDavClient(readCloudSettings()).list()).find(file => !file.site).name;
  const id = crypto.randomUUID(); const stage = cloudStage(id); fs.mkdirSync(stage, { mode: 0o700 });
  fs.writeFileSync(path.join(stage, "prepared.json"), JSON.stringify({ expiresAt: Date.now() + 60_000, settingsVersion: readCloudSettings().version }));
  writeCloudTask({ id, name, kind: "prepare", status: "completed", phase: "ready", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  await deleteCloudBackup(name);
  assert.equal(remote.has(name), false); assert.equal(fs.existsSync(stage), false);
  assert.equal(getCloudTask(), null);
  assert.throws(() => preparedCloudDownload(id));
});


test("upload progress follows transferred bytes and remains pending until DAV acknowledges", async () => {
  const file = path.join(root, "upload-progress.bin"); fs.writeFileSync(file, Buffer.alloc(32 * 1024 * 1024, 7));
  const name = `progress-${crypto.randomUUID()}.bin`;
  const samples = []; let completed = false;
  uploadDelayMs = 1250;
  let resume;
  pauseUpload = new Promise(resolve => { resume = resolve; });
  const pending = new WebDavClient(readCloudSettings()).upload(name, file, progress => samples.push({ ...progress, completed }));
  try {
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.ok(samples.at(-1).transferredBytes > 0);
    assert.ok(samples.at(-1).transferredBytes < samples.at(-1).totalBytes, "a stalled receiver must not show the entire file as sent");
  } finally { pauseUpload = null; resume(); }
  try { await pending; completed = true; } finally { uploadDelayMs = 0; }
  assert.equal(samples[0].transferredBytes, 0); assert.equal(samples[0].totalBytes, fs.statSync(file).size);
  assert.equal(samples[0].remainingSeconds, null);
  assert.ok(samples.length >= 3, "periodic progress is emitted while waiting for the server");
  for (let i = 1; i < samples.length; i++) {
    assert.ok(samples[i].transferredBytes >= samples[i - 1].transferredBytes);
    assert.ok(samples[i].transferredBytes <= samples[i].totalBytes);
    assert.equal(samples[i].completed, false);
  }
  const last = samples.at(-1);
  assert.equal(last.transferredBytes, last.totalBytes); assert.ok(last.bytesPerSecond > 0);
  assert.ok(last.elapsedSeconds >= 1); assert.equal(last.remainingSeconds, 0);
  assert.deepEqual(remote.get(name), fs.readFileSync(file)); remote.delete(name);
  uploadStatus = 413;
  try { await assert.rejects(new WebDavClient(readCloudSettings()).upload(name, file), /413.*大小限制/); }
  finally { uploadStatus = 201; }
});

test("cloud backup downloads stream the original encrypted bytes without changing restore status", async () => {
  const name = `yezi-complete-20261008T000000Z-other.example-${crypto.randomUUID()}.tar.gz.enc`;
  const encrypted = fs.readFileSync(path.join(root, "remote.enc")); remote.set(name, encrypted);
  const before = getCloudTask();
  const download = await downloadCloudBackup(name);
  assert.equal(download.size, encrypted.length);
  assert.deepEqual(Buffer.from(await new Response(download.body).arrayBuffer()), encrypted);
  assert.deepEqual(getCloudTask(), before);
  await assert.rejects(downloadCloudBackup("../.env.local"), /有效的云备份/);
  await assert.rejects(downloadCloudBackup(`yezi-complete-20261008T000000Z-missing.example-${crypto.randomUUID()}.tar.gz.enc`), /不存在/);
  await assert.rejects(new WebDavClient(readCloudSettings()).streamDownload(name, encrypted.length + 1), /大小发生变化/);
  remote.delete(name);
});
