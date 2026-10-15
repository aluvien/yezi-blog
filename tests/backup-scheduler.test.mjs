import test from 'node:test';
import assert from 'node:assert/strict';
import { backupRetryDelay, isDatabaseNotInitializedError, runBackupAttempt } from '../src/lib/backup-retry.ts';
const day=24*60*60*1000;
const fresh=()=>({failures:0,localComplete:false,alerted:false});
test('new databases retry without false alarms; other failures use bounded backoff',()=>{
  const missing=new Error('数据库不存在：/temporary/data/blog.db');
  assert.equal(isDatabaseNotInitializedError(missing),true);
  assert.equal(backupRetryDelay(missing,day),60_000);
  assert.deepEqual([1,2,3,4].map(n=>backupRetryDelay(new Error('disk'),day,n)),[60_000,300_000,900_000,day]);
});
test('cloud retry reuses the completed local step and emits one failure and recovery message',async()=>{
  const state=fresh(),messages=[];let local=0,cloud=0;
  const deps={local:async()=>{local++;},cloud:async()=>{if(++cloud<3)throw new Error('WebDAV PUT 失败（413）：服务器拒绝请求。');},notify:async m=>{messages.push(m);return true;}};
  assert.equal(await runBackupAttempt(state,deps,day),60_000);
  assert.equal(await runBackupAttempt(state,deps,day),300_000);
  assert.equal(await runBackupAttempt(state,deps,day),day);
  assert.equal(local,1);assert.equal(cloud,3);assert.equal(messages.length,2);assert.match(messages[0],/云端备份.*\n原因：WebDAV PUT/s);assert.match(messages[1],/已恢复/);assert.deepEqual(state,fresh());
});
test('retries stop after three, notification failure cannot stop scheduling, and secrets are redacted',async()=>{
  const state=fresh(),messages=[];
  const deps={local:async()=>{throw new Error('https://user:secret@dav.test password=very-secret');},cloud:async()=>{assert.fail('local failed');},notify:async m=>{messages.push(m);throw new Error('offline');}};
  for(const delay of [60_000,300_000,900_000,day])assert.equal(await runBackupAttempt(state,deps,day),delay);
  assert.deepEqual(state,fresh());assert.match(messages.at(-1),/本轮重试已结束/);
  for(const m of messages){assert.ok(!m.includes('very-secret'));assert.ok(!m.includes('user:secret'));}
});
test('initialization is quiet and does not consume the retry budget',async()=>{
  const state=fresh();assert.equal(await runBackupAttempt(state,{local:async()=>{throw new Error('数据库不存在：fixture');},cloud:async()=>assert.fail(),notify:async()=>assert.fail()},day),60_000);assert.deepEqual(state,fresh());
});
