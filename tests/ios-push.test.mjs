import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync, verify } from 'node:crypto';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yezi-push-'));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, 'data/blog.db');
process.env.APNS_SITE_URL = 'https://yezi.test';
process.env.APNS_KEY_ID = 'TESTKEY001'; process.env.APNS_TEAM_ID = 'TESTTEAM01';
process.env.ADMIN_API_TOKEN = 'test-push-auth-token-more-than-thirty-two-characters';
const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
process.env.APNS_PRIVATE_KEY = privateKey.export({ type: 'pkcs8', format: 'pem' });
const { db, createSession, getSessionByToken } = await import('../src/lib/db.ts');
const { createAPNsJWT, pushConfiguration } = await import('../src/lib/apns.ts');
const push = await import('../src/lib/ios-push.ts');
const routes = await import('../src/app/api/admin/v1/push-devices/route.ts');
const sessionToken = 'unit-test-session';
const id = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const registration = (installation_id = id) => ({ installation_id, token: 'ab'.repeat(32), environment: 'production', site_root: 'https://yezi.test', comments: true, music: true });
function reset() {
  db.exec('DELETE FROM push_outbox; DELETE FROM push_devices; DELETE FROM push_health_state; DELETE FROM sessions;');
  createSession(sessionToken, Date.now() + 3600000);
  return getSessionByToken(sessionToken).id;
}
const event = (key = 'comment:1') => ({ key, kind: 'comment', title: '新评论', body: '你好', comment_id: 1 });
const rows = () => db.prepare('SELECT * FROM push_outbox ORDER BY id').all();
test.after(() => { db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('APNs ES256 JWT signs the correct issuer and uses the 64-byte raw signature', () => {
  const jwt = createAPNsJWT(process.env.APNS_PRIVATE_KEY, 'KEY', 'TEAM', 12345);
  const [header, payload, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'KEY' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iss: 'TEAM', iat: 12345 });
  assert.equal(Buffer.from(signature, 'base64url').length, 64);
  assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});
test('registration accepts variable-length device tokens and rejects malformed or unsafe roots', () => {
  assert.equal(push.parsePushRegistration(registration()).site_root, 'https://yezi.test');
  assert.ok(push.parsePushRegistration({ ...registration(), token: 'bc'.repeat(48) }));
  for (const changes of [{ token: 'not-a-token' }, { token: 'abc' }, { environment: 'sandbox' }, { comments: 'true' }, { site_root: 'https://user:pass@yezi.test' }, { site_root: 'https://yezi.test/other' }, { site_root: 'http://yezi.test' }]) {
    assert.equal(push.parsePushRegistration({ ...registration(), ...changes }), null);
  }
  const original = process.env.APNS_SITE_URL;
  process.env.APNS_SITE_URL = 'https://user:password@yezi.test'; assert.equal(pushConfiguration().configured, false);
  process.env.APNS_SITE_URL = original;
});
test('comment events deduplicate and respect per-device switches and canonical site', () => {
  const session = reset(); push.registerPushDevice(registration(), session);
  assert.equal(push.enqueuePush(event()), 1); assert.equal(push.enqueuePush(event()), 0);
  const payload = JSON.parse(rows()[0].payload);
  assert.equal(payload.yezi.comment_id, 1); assert.equal(payload.yezi.site_root, 'https://yezi.test');
  push.registerPushDevice({ ...registration(id2), token: 'cd'.repeat(32), comments: false }, session);
  assert.equal(push.enqueuePush(event('comment:2')), 1);
  push.registerPushDevice({ ...registration(), site_root: 'https://other.test' }, session);
  assert.equal(push.enqueuePush(event('comment:3')), 0);
});
test('logout, expired sessions and password rotation stop delivery', async () => {
  let session = reset(); push.registerPushDevice(registration(), session); push.enqueuePush(event());
  db.prepare('DELETE FROM sessions WHERE id=?').run(session);
  let sent = 0; await push.drainPushOutbox(async () => { sent++; return { accepted: true, reason: 'Accepted' }; });
  assert.equal(sent, 0); assert.equal(rows()[0].state, 'cancelled');
  session = reset(); push.registerPushDevice(registration(), session);
  db.prepare('UPDATE sessions SET expires_at=0').run(); assert.equal(push.enqueuePush(event()), 0);
  db.prepare('UPDATE sessions SET expires_at=?,generation=generation+1').run(Date.now()+60000); assert.equal(push.enqueuePush(event()), 0);
});
test('transient failures retry and successful delivery is not sent again', async () => {
  push.registerPushDevice(registration(), reset()); push.enqueuePush(event());
  await push.drainPushOutbox(async () => ({ accepted: false, reason: 'ServiceUnavailable', retry: true }));
  assert.equal(rows()[0].attempts, 1); assert.equal(rows()[0].state, 'pending');
  assert.ok(rows()[0].next_attempt_at > Date.now());
  db.prepare('UPDATE push_outbox SET next_attempt_at=0').run();
  let sent = 0; const deliver = async () => { sent++; return { accepted: true, reason: 'Accepted' }; };
  await push.drainPushOutbox(deliver); await push.drainPushOutbox(deliver);
  assert.equal(sent, 1); assert.equal(rows()[0].state, 'sent');
});
test('parallel workers claim each queued notification once', async () => {
  push.registerPushDevice(registration(), reset()); push.enqueuePush(event());
  let sent = 0; let resume;
  const blocked = new Promise(r => { resume = r; });
  const first = push.drainPushOutbox(async () => { sent++; await blocked; return { accepted: true, reason: 'Accepted' }; });
  await push.drainPushOutbox(async () => { sent++; return { accepted: true, reason: 'Accepted' }; });
  resume(); await first; assert.equal(sent, 1);
});
test('APNs invalid device response disables only the matching token', async () => {
  const session = reset(); push.registerPushDevice(registration(), session); push.enqueuePush(event());
  await push.drainPushOutbox(async () => ({ accepted: false, reason: 'Unregistered', disable: true }));
  assert.equal(db.prepare('SELECT enabled FROM push_devices').get().enabled, 0);
  assert.equal(push.enqueuePush(event('comment:2')), 0);
});
test('token rotation removes old pending events, same binding preserves queued comments', () => {
  const session = reset(); push.registerPushDevice(registration(), session); push.enqueuePush(event());
  push.registerPushDevice(registration(), session); assert.equal(rows().length, 1);
  push.registerPushDevice({ ...registration(), token: 'cd'.repeat(32) }, session); assert.equal(rows().length, 0);
  assert.equal(push.enqueuePush(event('comment:2')), 1);
  push.unregisterPushDevice(id, 'wrong-session'); assert.equal(rows().length, 1);
  push.unregisterPushDevice(id, session); assert.equal(rows().length, 0);
});
test('QQ alerts persist incident deduplication and ignore network-only failures', () => {
  push.registerPushDevice(registration(), reset());
  push.notifyMusicPushHealth('missing_session'); assert.equal(rows().length, 0);
  push.notifyMusicPushHealth('healthy', 'v1');
  for (const status of ['unavailable', 'unverified', 'playback_unavailable']) push.notifyMusicPushHealth(status, 'v1');
  assert.equal(rows().length, 0);
  push.notifyMusicPushHealth('expired', 'v1'); push.notifyMusicPushHealth('expired', 'v1');
  push.notifyMusicPushHealth('unavailable', 'v1'); push.notifyMusicPushHealth('missing_session');
  assert.equal(rows().length, 1);
  push.notifyMusicPushHealth('healthy', 'v1'); push.notifyMusicPushHealth('expired', 'v1'); assert.equal(rows().length, 2);
});
test('test notification is device-bound and rate limited', () => {
  const session = reset(); push.registerPushDevice(registration(), session);
  assert.equal(push.enqueuePushTest(id, 'wrong'), 'missing');
  assert.equal(push.enqueuePushTest(id, session), 'queued');
  assert.equal(push.enqueuePushTest(id, session), 'rate_limited');
  assert.equal(rows().length, 1); assert.equal(rows()[0].kind, 'test');
});
test('notification API rejects cross-origin writes and bearer registration, status never returns secrets', async () => {
  const rejected = await routes.POST(new Request('https://yezi.test/api/admin/v1/push-devices', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(rejected.status, 403);
  const headers = { authorization: `Bearer ${process.env.ADMIN_API_TOKEN}`, 'content-type': 'application/json' };
  const response = await routes.POST(new Request('https://yezi.test/api/admin/v1/push-devices', { method: 'POST', headers, body: JSON.stringify(registration()) }));
  assert.equal(response.status, 403);
  const status = await routes.GET(new Request('https://yezi.test/api/admin/v1/push-devices', { headers }));
  assert.deepEqual((await status.json()).data, { configured: true });
});
