import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yezi-data-protection-'));
Object.assign(process.env, { BLOG_ROOT: root, BLOG_DB_PATH: path.join(root,'data/blog.db'), DEPLOY_PROJECT_DIR: root, NODE_ENV: 'production' });
for (const key of ['BLOG_ENV_FILE','BLOG_BACKUP_DIR','QQ_MUSIC_SESSION_PATH','BLOG_BUILD_READONLY']) delete process.env[key];
const d = await import('../src/lib/db.ts');
const a = await import('../src/lib/admin/attachments.ts');
const b = await import('../src/lib/admin-backup.ts');
const trash = await import('../src/lib/attachment-trash.ts');
const locks = await import('../src/lib/data-files-lock.ts');
const { attachmentSources, referencedUploadPaths } = await import('../src/lib/attachment-usage.ts');
function fixture(name) {
  const rel='/uploads/'+name, abs=path.join(root,'data',rel);
  fs.mkdirSync(path.dirname(abs),{recursive:true}); fs.writeFileSync(abs,'fixture image');
  return {rel,abs,row:d.createAttachment({path:rel,original_name:name,mime_type:'image/png',size:13})};
}
function deferred() { let resolve; const promise=new Promise(r=>resolve=r);return {promise,resolve}; }
test.after(()=>{d.db.close();fs.rmSync(root,{recursive:true,force:true});});

test('cleanup protects life events, works and GitHub covers, including encoded paths', async()=>{
  const work=fixture('work.png'),life=fixture('生活.png'),github=fixture('github.png');
  d.createWork({title:'Work cover',cover:work.rel});
  d.createLifeEvent({title:'Life photo',content:'content',occurred_at:'2026-10-15',date_precision:'day',images:[encodeURI(life.rel)]});
  d.registerGithubRepository({owner:'fixture',name:'repo',fullName:'fixture/repo',repoUrl:'https://github.com/fixture/repo',cover:github.rel});
  assert.equal((await a.clearUnusedAttachments()).data.deletedCount,0);
  for (const image of [work,life,github]) { assert.ok(fs.existsSync(image.abs)); assert.ok(d.listAttachments().find(x=>x.id===image.row.id).referenced); }
});

test('trash restores original URLs, prevents overwrite/traversal and does not resurrect a deleted post relation',async()=>{
  const img=fixture('recover.png');
  const post=d.createPost({title:'Temporary owner',content:'',status:'draft'});
  d.db.prepare('UPDATE attachments SET post_id=? WHERE id=?').run(post.id,img.row.id);
  assert.equal((await a.deleteAttachmentById(img.row.id)).ok,true);
  assert.equal(fs.existsSync(img.abs),false);
  const entry=trash.listTrashedAttachments().find(x=>x.path===img.rel);assert.ok(entry);
  d.db.prepare('DELETE FROM posts WHERE id=?').run(post.id);
  fs.writeFileSync(img.abs,'occupied');
  assert.equal((await a.restoreAttachmentFromTrash(entry.id)).ok,false);
  assert.equal(fs.readFileSync(img.abs,'utf8'),'occupied'); fs.rmSync(img.abs);
  assert.equal((await a.restoreAttachmentFromTrash('../outside')).ok,false);
  assert.equal((await a.restoreAttachmentFromTrash(entry.id)).ok,true);
  assert.equal(fs.readFileSync(img.abs,'utf8'),'fixture image');
  assert.equal(d.db.prepare('SELECT post_id FROM attachments WHERE path=?').get(img.rel).post_id,null);
  assert.ok(!trash.listTrashedAttachments().some(x=>x.id===entry.id));
  assert.equal((await a.restoreAttachmentFromTrash(entry.id)).ok,false);
});

test('an image newly referenced during an asynchronous deletion is put back', async()=>{
  const img=fixture('late-reference.png');const original=fs.promises.rename;
  fs.promises.rename=async(from,to)=>{await original(from,to);if(from===img.abs)d.createPost({title:'Concurrent reference',content:`![](${img.rel})`,status:'published'});};
  try {assert.equal((await a.deleteAttachmentById(img.row.id)).ok,false);assert.ok(d.getAttachment(img.row.id));assert.ok(fs.existsSync(img.abs));}
  finally {fs.promises.rename=original;}
});

test('backup holds uploads through snapshot/copy, so a queued cleanup cannot remove snapshot media',async()=>{
  const img=fixture('snapshot.png');const post=d.createPost({title:'Snapshot',content:`![image](${img.rel})`,status:'published'});
  let pending;
  const job=b.startAdminBackup();
  await b.executeAdminBackup(job.status.id,phase=>{if(phase==='files'){d.db.prepare('UPDATE posts SET content=? WHERE id=?').run('image removed',post.id);pending=a.deleteAttachmentById(img.row.id);}});
  const archive=b.getAdminBackupDownload(job.status.id);assert.ok(archive);
  assert.equal((await pending).ok,true);assert.equal(fs.existsSync(img.abs),false);
  const extraction=path.join(root,'snapshot-extracted');fs.mkdirSync(extraction);
  await b.verifyAdminBackupArchive(archive.path,extraction);
  assert.ok(fs.existsSync(path.join(extraction,'data',img.rel)));
  const snapshot=new Database(path.join(extraction,'data/blog.db'),{readonly:true});
  try {assert.ok(snapshot.prepare('SELECT content FROM posts WHERE id=?').get(post.id).content.includes(img.rel));} finally{snapshot.close();}
});

test('an externally removed referenced image cannot produce a successful complete backup',async()=>{
  const img=fixture('external-removal.png');const post=d.createPost({title:'Missing',content:`![image](${img.rel})`,status:'draft'});
  const job=b.startAdminBackup();
  await b.executeAdminBackup(job.status.id,phase=>{if(phase==='files')fs.rmSync(img.abs);});
  assert.equal(b.getAdminBackupStatus().status,'failed');assert.equal(b.getAdminBackupDownload(job.status.id),null);
  d.db.prepare('DELETE FROM posts WHERE id=?').run(post.id);
});

test('retention failure preserves the newly verified backup and reports a warning',async()=>{
  const prior=[];for(let i=0;i<3;i++){const job=b.startAdminBackup();await b.executeAdminBackup(job.status.id);const archive=b.getAdminBackupDownload(job.status.id);assert.ok(archive);prior.push(archive.path);fs.utimesSync(archive.path,new Date(Date.now()+i*1000),new Date(Date.now()+i*1000));}
  const original=fs.promises.rm;
  fs.promises.rm=async(file,options)=>{if(file===prior[0])throw Object.assign(new Error('Injected failure'),{code:'EACCES'});return original(file,options);};
  try {const job=b.startAdminBackup();await b.executeAdminBackup(job.status.id);assert.equal(b.getAdminBackupStatus().status,'completed');assert.match(b.getAdminBackupStatus().warning,/旧备份清理/);assert.ok(b.getAdminBackupDownload(job.status.id));}
  finally {fs.promises.rm=original;}
});

test('restoration waits for an inflight file deletion and rejects stale GitHub sync responses',async()=>{
  const img=fixture('restored.png');
  const gh=d.registerGithubRepository({owner:'restore',name:'repo',fullName:'restore/repo',repoUrl:'https://github.com/restore/repo'});
  const cfg=await import('../src/lib/cloud-backup-config.ts');cfg.saveCloudSettings({endpoint:'https://dav.example.test',directory:'backup',username:'fixture',password:'fixture',dailyEnabled:false,keep:2});
  const job=b.startAdminBackup();await b.executeAdminBackup(job.status.id);const archive=b.getAdminBackupDownload(job.status.id);assert.ok(archive);
  const cloud=await import('../src/lib/cloud-backup.ts');const id=crypto.randomUUID(),stage=cloud.cloudStage(id);fs.mkdirSync(path.join(stage,'content'),{recursive:true});fs.copyFileSync(archive.path,path.join(stage,'complete.tar.gz'));await b.verifyAdminBackupArchive(archive.path,path.join(stage,'content'));
  const {fileHash}=await import('../src/lib/cloud-backup-archive.ts');fs.writeFileSync(path.join(stage,'prepared.json'),JSON.stringify({settingsVersion:cfg.requireCloudSettings().version,archiveHash:await fileHash(archive.path),expiresAt:Date.now()+60000}));const now=new Date().toISOString();cloud.writeCloudTask({id,kind:'prepare',status:'completed',phase:'ready',createdAt:now,updatedAt:now});
  const gate=deferred(),ready=deferred(),network=deferred();const originalRename=fs.promises.rename,originalFetch=globalThis.fetch;
  fs.promises.rename=async(from,to)=>{if(from===img.abs){ready.resolve();await gate.promise;}return originalRename(from,to);};
  globalThis.fetch=async()=>{await network.promise;return new Response(JSON.stringify({full_name:'restore/repo',description:'stale response',stargazers_count:123}),{status:200});};
  try {
    const pendingDelete=a.deleteAttachmentById(img.row.id);await ready.promise;
    const sync=await import('../src/lib/admin/github-repositories.ts');
    const pendingSync=sync.syncGithubRepositoryMetadata(gh.id),pendingBatch=sync.syncAllGithubRepositoryMetadata();
    let completed=false;
    const restoration=(await import('../src/lib/cloud-backup-restore.ts')).applyCloudRestore(id,'恢复数据').then(()=>{completed=true;});
    await new Promise(r=>setTimeout(r,100));assert.equal(completed,false);gate.resolve();assert.equal((await pendingDelete).ok,true);
    await restoration;network.resolve();assert.equal((await pendingSync).ok,false);assert.equal((await pendingBatch).ok,false);
    assert.ok(fs.existsSync(img.abs));assert.ok(d.getAttachment(img.row.id));assert.notEqual(d.getGithubRepository(gh.id).description,'stale response');
  } finally {gate.resolve();network.resolve();fs.promises.rename=originalRename;globalThis.fetch=originalFetch;}
});

test('queued mutations reject an epoch change, nested file leases are reentrant',async()=>{
  const guard=await import('../src/lib/cloud-restore-guard.ts');
  const old=guard.currentDataEpoch();const entered=deferred(),gate=deferred();
  const holding=locks.withDataFilesLock(async()=>{await locks.withDataFilesLock(async()=>{});entered.resolve();await gate.promise;});await entered.promise;
  let mutated=false;const rejected=assert.rejects(locks.withDataFileMutation(async()=>{mutated=true;},old),/恢复流程/);
  fs.writeFileSync(path.join(root,'data/backups/cloud/restore-epoch'),crypto.randomUUID());gate.resolve();await holding;await rejected;assert.equal(mutated,false);
});

test('backup reference inspection supports historical schemas and ignores code/external images',()=>{
  const old=new Database(':memory:');old.exec('CREATE TABLE posts(id INTEGER,title TEXT,content TEXT)');
  old.prepare('INSERT INTO posts VALUES(1,?,?)').run('Old','![local](/uploads/a%20b.png?x=1)\n![remote](https://cdn.example/uploads/external.png)\n```js\nconst sample="/uploads/example.png"\n```');
  assert.deepEqual(referencedUploadPaths(attachmentSources(old)),['/uploads/a b.png']);old.close();
});
