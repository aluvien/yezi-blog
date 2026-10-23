import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-native-backups-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data/blog.db");
process.env.ADMIN_API_TOKEN = "test-native-backup-token-long-enough";
process.env.DATA_BACKUP_KEY = crypto.randomBytes(32).toString("base64");
const { db, createMoment, createPost, createComment, listCommentsForAdmin, countCommentsForAdmin, countMomentCommentsBulk } = await import("../src/lib/db.ts");
const { runDbBackup } = await import("../src/lib/backup.ts");
const { runCompleteDataBackup } = await import("../src/lib/data-backup.ts");
const { prepareRestore, replaceOfflineData } = await import("../src/lib/backup-restore.ts");
const { listBackups, backupFile } = await import("../src/lib/backup-management.ts");
const { GET: comments } = await import("../src/app/api/admin/v1/comments/route.ts");
const { GET: moments } = await import("../src/app/api/admin/v1/moments/route.ts");
const { GET: backups, POST: backupPost } = await import("../src/app/api/admin/v1/native-backups/route.ts");
const { GET: download } = await import("../src/app/api/admin/v1/native-backups/download/route.ts");
const headers = { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`, "content-type": "application/json" };
const request = (pathname, options = {}) => new Request(`http://yezi.test${pathname}`, { headers, ...options });
test.after(() => { if (db.open) db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test("target-filtered admin comments and bulk counts include pending without mixing posts", async () => {
  const moment = createMoment({ content: "测试位置", images: [], location: "郑州市" });
  const second = createMoment({ content: "其他絮语", images: [] });
  const post = createPost({ title: "文章", content: "正文", status: "published" });
  const one = createComment({ ip: "127.0.0.1", target_type: "moment", target_id: moment.id, nickname: "A", content: "待审核" });
  const two = createComment({ ip: "127.0.0.1", target_type: "moment", target_id: moment.id, nickname: "B", content: "已通过" });
  db.prepare("UPDATE comments SET status = 'approved', admin_reply = '回复不另外计数' WHERE id = ?").run(two.id);
  createComment({ ip: "127.0.0.1", target_type: "moment", target_id: second.id, nickname: "C", content: "其他" });
  createComment({ ip: "127.0.0.1", target_type: "post", target_id: post.id, nickname: "D", content: "文章评论" });
  assert.equal(countCommentsForAdmin("all", "moment", moment.id), 2);
  assert.deepEqual(listCommentsForAdmin({ targetType: "moment", targetId: moment.id }).map(x => x.id), [one.id, two.id]);
  assert.equal(countMomentCommentsBulk([moment.id]).get(moment.id), 2);
  const response = await comments(request(`/api/admin/v1/comments?target_type=moment&target_id=${moment.id}&limit=1`));
  const result = await response.json(); assert.equal(result.meta.total, 2); assert.equal(result.data.length, 1);
  for (const query of ["target_id=1", "target_type=moment", "target_type=moment&target_id=-1", "target_type=moment&target_id=1%20OR%201=1"]) {
    assert.equal((await comments(request(`/api/admin/v1/comments?${query}`))).status, 400);
  }
  const feed = await (await moments(request("/api/admin/v1/moments"))).json();
  assert.equal(feed.data.find(x => x.id === moment.id).comment_count, 2);
  assert.equal(feed.data.find(x => x.id === moment.id).location, "郑州市");
});

test("backup API authenticates, validates IDs and streams the exact backup", async () => {
  const rejected = await backupPost(new Request("http://yezi.test/api/admin/v1/native-backups", { method: "POST", headers: { origin: "http://hostile.test", "content-type": "application/json" }, body: JSON.stringify({ action: "create", kind: "database" }) }));
  assert.equal(rejected.status, 403);
  const snapshot = await runDbBackup();
  const id = `database:${path.basename(snapshot.path)}`;
  assert.ok(listBackups().some(item => item.id === id));
  const overview = await backups(request("/api/admin/v1/native-backups"));
  assert.equal(overview.status, 200);
  assert.ok((await overview.json()).data.backups.some(item => item.id === id));
  assert.throws(() => backupFile("database:../../blog.db"));
  const link = path.join(path.dirname(snapshot.path), "blog-symlink.db"); fs.symlinkSync(snapshot.path, link);
  assert.throws(() => backupFile("database:blog-symlink.db")); fs.unlinkSync(link);
  const result = await download(request(`/api/admin/v1/native-backups/download?id=${encodeURIComponent(id)}`));
  assert.equal(result.status, 200); assert.match(result.headers.get("cache-control"), /no-store/);
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), fs.readFileSync(snapshot.path));
  assert.equal((await backupPost(request("/api/admin/v1/native-backups", { method: "POST", body: JSON.stringify({ action: "restore", kind: "database", backupId: id }) }))).status, 400);
});

test("complete backup authenticates before extraction and restore rollback recovers live data", async () => {
  fs.mkdirSync(path.join(root, "data/uploads"), { recursive: true });
  fs.writeFileSync(path.join(root, "data/uploads/sample.txt"), "original");
  fs.writeFileSync(path.join(root, "data/deploy-commit"), "keep-current-release");
  const complete = await runCompleteDataBackup();
  const bad = path.join(root, "tampered.enc"); const bytes = fs.readFileSync(complete.path); bytes[bytes.length - 1] ^= 1; fs.writeFileSync(bad, bytes);
  await assert.rejects(prepareRestore(bad, "complete"));
  const prepared = await prepareRestore(complete.path, "complete");
  fs.writeFileSync(path.join(root, "data/uploads/sample.txt"), "newer live data");
  db.close(); // Only restore an offline database, just like the PM2 worker.
  const replacement = replaceOfflineData(prepared, "aaaa-bbbb");
  assert.equal(fs.readFileSync(path.join(root, "data/uploads/sample.txt"), "utf8"), "original");
  assert.equal(fs.readFileSync(path.join(root, "data/deploy-commit"), "utf8"), "keep-current-release");
  const restored = new Database(process.env.BLOG_DB_PATH);
  assert.equal(restored.pragma("integrity_check", { simple: true }), "ok");
  assert.equal(restored.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
  restored.close();
  // Rollback also removes newly-created sidecars from an unsuccessful restart.
  fs.writeFileSync(process.env.BLOG_DB_PATH + "-wal", "failed restart sidecar");
  replacement.rollback();
  assert.equal(fs.readFileSync(path.join(root, "data/uploads/sample.txt"), "utf8"), "newer live data");
  const original = new Database(process.env.BLOG_DB_PATH); assert.equal(original.pragma("integrity_check", { simple: true }), "ok"); original.close();
  prepared.cleanup();
});

test("detached restore worker stops only its configured supervisor, restarts and reports success", async () => {
  const { startBackupJob, latestBackupJob } = await import("../src/lib/backup-management.ts");
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const project = path.resolve(import.meta.dirname, "..");
  const fakeBin = path.join(root, "fake-bin"); fs.mkdirSync(fakeBin);
  const pmState = path.join(root, "pm-state"); fs.writeFileSync(pmState, "online");
  const fakePM2 = path.join(fakeBin, "pm2");
  fs.writeFileSync(fakePM2, `#!${process.execPath}\nconst fs=require('node:fs');const args=process.argv.slice(2);const file=${JSON.stringify(pmState)};if(args[0]==='jlist'){console.log(JSON.stringify([{name:'yezi-test-only',pid:fs.readFileSync(file,'utf8')==='online'?123:0,pm2_env:{pm_cwd:${JSON.stringify(project)},status:fs.readFileSync(file,'utf8')}}]));}else if(args[1]==='yezi-test-only'&&['stop','restart'].includes(args[0])){fs.writeFileSync(file,args[0]==='stop'?'stopped':'online');}else{process.exit(8);}`, { mode: 0o700 });
  const server = createServer((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end('{"status":"ok"}'); });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const keys = ["PATH", "DEPLOY_PROJECT_DIR", "DEPLOY_RELEASES_DIR", "DEPLOY_PM2_NAME", "DEPLOY_HEALTH_URL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { PATH: fakeBin + path.delimiter + process.env.PATH, DEPLOY_PROJECT_DIR: project, DEPLOY_RELEASES_DIR: path.join(root, "releases"), DEPLOY_PM2_NAME: "yezi-test-only", DEPLOY_HEALTH_URL: `http://127.0.0.1:${server.address().port}` });
  try {
    const selected = listBackups().find(item => item.kind === "complete");
    const { acquireCloudLock, releaseCloudLock } = await import("../src/lib/cloud-backup-lock.ts");
    const cloudID = crypto.randomUUID();
    acquireCloudLock(cloudID);
    try {
      await startBackupJob("restore", "complete", selected.id);
      let blocked;
      for (let i = 0; i < 100; i++) {
        await new Promise(resolve => setTimeout(resolve, 50)); blocked = latestBackupJob();
        if (blocked.status === "failed" && !fs.existsSync(path.join(root, "data/backup-jobs/.lock"))) break;
      }
      assert.equal(blocked.status, "failed");
      assert.match(blocked.message, /云备份任务正在执行/);
      assert.equal(fs.readFileSync(pmState, "utf8"), "online");
      assert.equal(JSON.parse(fs.readFileSync(path.join(root, "data/backups/cloud/.lock"), "utf8")).id, cloudID);
    } finally { releaseCloudLock(cloudID); }
    const queued = await startBackupJob("restore", "complete", selected.id);
    assert.equal(queued.status, "queued");
    let result;
    for (let i = 0; i < 100; i++) {
      await new Promise(resolve => setTimeout(resolve, 100)); result = latestBackupJob();
      if (result.status === "failed" || (result.status === "succeeded" && !fs.existsSync(path.join(root, "data/backup-jobs/.lock")))) break;
    }
    assert.equal(result.status, "succeeded", JSON.stringify(result));
    assert.match(result.resultId, /^complete:/);
    assert.equal(fs.readFileSync(pmState, "utf8"), "online");
    assert.equal(fs.existsSync(path.join(root, "data/backup-jobs/.lock")), false);
    assert.equal(fs.existsSync(path.join(root, "data/backup-jobs/restore-write-hold")), false);
  } finally {
    server.close();
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
