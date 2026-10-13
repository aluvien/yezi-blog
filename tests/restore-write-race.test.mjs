import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { pathToFileURL } from 'node:url';

const repo = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yezi-audit-repro-'));
const mod = name => import(pathToFileURL(path.join(repo, name)).href);
Object.assign(process.env, {
  BLOG_ROOT: root, BLOG_DB_PATH: path.join(root, 'data', 'blog.db'),
  DEPLOY_PROJECT_DIR: root, ADMIN_PASSWORD: 'isolated-audit-password',
  QQ_MUSIC_SESSION_PATH: path.join(root, 'data', 'qq-music-session.json'),
  NEXT_PUBLIC_SITE_URL: 'https://audit.example.test', NODE_ENV: 'production',
});
for (const key of ['BLOG_ENV_FILE', 'BLOG_BACKUP_DIR', 'BLOG_BUILD_READONLY', 'DATA_BACKUP_KEY']) delete process.env[key];
globalThis.AsyncLocalStorage ??= AsyncLocalStorage;
const { db, createPost, getPost } = await mod('src/lib/db.ts');
const originalFetch = globalThis.fetch;
const findings = {};
try {
  // Produce a real archive with a representative deploy cache entry.
  const cacheFile = path.join(root, 'data', 'npm-cache', '_cacache', 'content-v2', 'artifact');
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  fs.writeFileSync(cacheFile, crypto.randomBytes(1024 * 1024));
  const post = createPost({ title: 'Snapshot title', content: 'Snapshot body', status: 'published' });
  const { startAdminBackup, executeAdminBackup, getAdminBackupDownload, verifyAdminBackupArchive } = await mod('src/lib/admin-backup.ts');
  const { saveCloudSettings, requireCloudSettings } = await mod('src/lib/cloud-backup-config.ts');
  saveCloudSettings({ endpoint: 'https://dav.example.test', directory: 'backup', username: 'fixture', password: 'fixture', dailyEnabled: false, keep: 2 });
  const backup = startAdminBackup();
  await executeAdminBackup(backup.status.id);
  const archive = getAdminBackupDownload(backup.status.id);
  assert.ok(archive, 'fixture archive created');
  const { cloudStage, writeCloudTask } = await mod('src/lib/cloud-backup.ts');
  const id = crypto.randomUUID();
  const stage = cloudStage(id);
  fs.mkdirSync(path.join(stage, 'content'), { recursive: true });
  fs.copyFileSync(archive.path, path.join(stage, 'complete.tar.gz'));
  await verifyAdminBackupArchive(archive.path, path.join(stage, 'content'));
  const manifest = JSON.parse(fs.readFileSync(path.join(stage, 'content', 'manifest.json')));
  findings.backupIncludesDeployCache = manifest.files.filter(file => file.path.startsWith('data/npm-cache/')).map(file => ({path:file.path, bytes:file.sizeBytes}));
  assert.equal(findings.backupIncludesDeployCache.length, 0);

  // Restore an actual backup while an already accepted article save waits for its model.
  const { fileHash } = await mod('src/lib/cloud-backup-archive.ts');
  fs.writeFileSync(path.join(stage, 'prepared.json'), JSON.stringify({settingsVersion:requireCloudSettings().version,archiveHash:await fileHash(archive.path),expiresAt:Date.now()+60_000}));
  const now = new Date().toISOString();
  writeCloudTask({id,kind:'prepare',status:'completed',phase:'ready',createdAt:now,updatedAt:now});
  process.env.LLM_API_KEY = 'fixture-key';
  process.env.LLM_API_URL = 'https://llm.example.test/v1';
  let releaseModel;
  const modelGate = new Promise(resolve => {releaseModel=resolve;});
  globalThis.fetch = async () => {await modelGate; return new Response(JSON.stringify({choices:[{message:{content:'{"slug":"stale-edit"}'}}]}),{status:200});};
  const { updatePostEntry } = await mod('src/lib/admin/posts.ts');
  const pendingCreate = (await mod('src/lib/admin/posts.ts')).createPostEntry({title:"Late new post",slug:"",content:"Late new content",cover:null,category:"",tags:"",attachmentIds:[],status:"published"});
  const pending = updatePostEntry(post.id,{title:'Edit from before restore',slug:'',content:'Stale content overwrites snapshot',cover:null,category:'',tags:'',attachmentIds:[],status:'published'});
  const { applyCloudRestore } = await mod('src/lib/cloud-backup-restore.ts');
  await applyCloudRestore(id,'恢复数据');
  const afterRestore = getPost(post.id).content;
  assert.equal(afterRestore,'Snapshot body');
  releaseModel();
  const saveResult = await pending;
  findings.restoreOverwrittenByInflightSave = {saveAccepted:saveResult.ok, afterRestore, afterPendingRequest:getPost(post.id).content};
  assert.equal(saveResult.ok,false);
  assert.match(saveResult.error,/恢复流程/);
  assert.equal((await pendingCreate).ok,false);
  assert.equal(getPost(post.id).content,'Snapshot body');
  assert.equal(db.prepare("SELECT count(*) AS n FROM posts").get().n,1);
  assert.ok(fs.existsSync(cacheFile),'Restore preserves the live deployment cache');
  const fresh={title:"Fresh title",slug:"fresh",content:"Fresh content",cover:null,category:"",tags:"",attachmentIds:[],status:"published"};
  assert.equal((await updatePostEntry(post.id,fresh)).ok,true);
  const {cloudRestoreGuardPath}=await mod('src/lib/cloud-restore-guard.ts');
  fs.writeFileSync(cloudRestoreGuardPath(),'fixture');
  assert.equal((await updatePostEntry(post.id,fresh)).ok,false);
  fs.rmSync(cloudRestoreGuardPath());
  globalThis.fetch = originalFetch;

  console.log('Restore write protection passed');
} finally {
  globalThis.fetch = originalFetch;
  db.close();
  fs.rmSync(root,{recursive:true,force:true});
}
