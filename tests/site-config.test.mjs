import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-site-config-"));
process.env.BLOG_ROOT = root;
process.env.BLOG_DB_PATH = path.join(root, "data", "blog.db");
process.env.QQ_MUSIC_SESSION_PATH = path.join(root, "qq.json");
process.env.NEXT_PUBLIC_SITE_URL = "https://old.example";
process.env.TELEGRAM_BOT_TOKEN = "mock-token";
process.env.TELEGRAM_CHAT_ID = "123";
process.env.TELEGRAM_ADMIN_USER_ID = "123";
const { db, getSiteSettings, setSiteSettings } = await import("../src/lib/db.ts");
const { normalizeSiteUrl } = await import("../src/lib/site-url.ts");
const { getSiteUrl, getBackupSiteIdentity, isCurrentSiteBackup } = await import("../src/lib/site-config.ts");
const { updateSiteSettings } = await import("../src/lib/admin/settings.ts");
const { parseCloudBackupName, CLOUD_FILE_PATTERN } = await import("../src/lib/webdav.ts");
const telegram = await import("../src/lib/telegram.ts");
const { checkAndNotifyQQMusicHealth } = await import("../src/lib/qq-music-health.ts");
const { processTelegramBotUpdates } = await import("../src/lib/telegram-bot.ts");
const { default: sitemap } = await import("../src/app/sitemap.ts");
const { default: robots } = await import("../src/app/robots.ts");
const { GET: rss } = await import("../src/app/rss.xml/route.ts");
const originalFetch = globalThis.fetch;
const calls = [];
let updates = [];
globalThis.fetch = async (url, init) => {
  assert.ok(String(url).startsWith("https://api.telegram.org/botmock-token/"), "tests must never call real external services");
  calls.push({ method: String(url).split("/").at(-1).split("?")[0], body: init.body instanceof FormData ? init.body : init.body ? JSON.parse(init.body) : null });
  return Response.json({ ok: true, result: String(url).includes("getUpdates?") ? updates.splice(0) : {} });
};
test.after(() => { globalThis.fetch = originalFetch; db.close(); fs.rmSync(root, { recursive: true, force: true }); });

test("website URL accepts only a canonical HTTP origin", () => {
  assert.equal(normalizeSiteUrl(" HTTPS://YEZI.ME:443/ "), "https://yezi.me");
  assert.equal(normalizeSiteUrl("http://127.0.0.1:3030/"), "http://127.0.0.1:3030");
  assert.equal(normalizeSiteUrl("https://[::1]:3030"), "https://[::1]:3030");
  assert.equal(normalizeSiteUrl(""), "");
  for (const value of ["yezi.me", "javascript:alert(1)", "https://user:secret@yezi.me", "https://yezi.me/path", "https://yezi.me/?x=1", "https://yezi.me/#fragment", "https://ye zi.me", "https://yezi.me\\evil", "https://", 'https://foo"bar', "https://foo%22bar", "https://foo&bar", `https://${"a".repeat(254)}.test`, `https://${"a".repeat(2050)}.test`]) assert.throws(() => normalizeSiteUrl(value), undefined, value);
});

test("saving a website URL applies immediately, rejects partial invalid writes and preserves backup ownership", async () => {
  assert.equal(getSiteUrl(), "https://old.example");
  const before = getBackupSiteIdentity();
  assert.match(before.siteId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(before.siteLabels, ["old.example"]);
  const snapshot = getSiteSettings();
  assert.equal((await updateSiteSettings({ site_name: "must not save", site_url: "https://yezi.me/admin" })).ok, false);
  assert.deepEqual(getSiteSettings(), snapshot);
  assert.equal((await updateSiteSettings({ site_url: "https://YEZI.ME/", backup_site_id: crypto.randomUUID() })).ok, true);
  assert.equal(getSiteUrl(), "https://yezi.me");
  const after = getBackupSiteIdentity();
  assert.equal(after.siteId, before.siteId);
  assert.deepEqual(after.siteLabels, ["old.example", "yezi.me"]);
  assert.equal(isCurrentSiteBackup({ site: "old.example" }, after), false);
  assert.equal(isCurrentSiteBackup({ site: "old.example", siteId: before.siteId }, after), false);
  assert.equal(isCurrentSiteBackup({ site: "yezi.me", siteId: crypto.randomUUID() }, after), false);
  assert.equal(isCurrentSiteBackup({ site: "foreign.example" }, after), false);
  assert.equal(isCurrentSiteBackup({ site: "yezi.me" }, after), true);
  assert.equal(isCurrentSiteBackup({ site: "yezi.me", siteId: before.siteId }, after), true);
  for (const subdomain of ["blog.yezi.me", "www.yezi.me", "api.blog.yezi.me"]) {
    assert.equal(isCurrentSiteBackup({ site: subdomain }, { ...after, siteLabels: [...after.siteLabels, subdomain] }), false);
    assert.equal(isCurrentSiteBackup({ site: subdomain, siteId: before.siteId }, after), false);
    assert.equal(isCurrentSiteBackup({ site: "yezi.me" }, { ...after, siteLabel: subdomain }), false);
  }
  assert.equal(isCurrentSiteBackup({ site: "127.0.0.1-3030" }, { ...after, siteLabel: "127.0.0.1-3100" }), false);
  assert.equal(isCurrentSiteBackup({}, after), false);
  assert.ok(sitemap().every(entry => entry.url.startsWith("https://yezi.me")));
  assert.equal(robots().sitemap, "https://yezi.me/sitemap.xml");
  assert.match(await rss().text(), /<link>https:\/\/yezi\.me<\/link>/);
});

test("backup names parse identified, legacy labelled and unlabelled archives without confusing hyphens", () => {
  const siteId = getBackupSiteIdentity().siteId;
  const id = crypto.randomUUID();
  const stamp = "20261008T010203Z";
  for (const label of ["yezi.me", "long-site-example.com-3030", "a".repeat(100)]) {
    const name = `yezi-complete-${stamp}-${label}-site-${siteId}-${id}.tar.gz.enc`;
    assert.equal(CLOUD_FILE_PATTERN.test(name), true);
    assert.deepEqual(parseCloudBackupName(name), { stamp, site: label, siteId });
    assert.deepEqual(parseCloudBackupName(`yezi-complete-${stamp}-${label}-${id}.tar.gz.enc`), { stamp, site: label });
  }
  const old = `yezi-complete-${stamp}-${id}.tar.gz.enc`;
  assert.deepEqual(parseCloudBackupName(old), { stamp });
  for (const bad of [`../${old}`, `${old}/extra`, old.replace(id, "invalid"), "personal-file.txt"]) {
    assert.equal(CLOUD_FILE_PATTERN.test(bad), false); assert.equal(parseCloudBackupName(bad), null);
  }
});

test("Telegram comments, music alerts, Bot replies and QR captions follow the saved website domain", async () => {
  calls.length = 0;
  await telegram.notifyNewComment({ commentId: 1, nickname: "<author>", content: "comment", targetType: "post", targetLabel: "post" });
  let message = calls.at(-1).body;
  assert.ok(message.text.startsWith("网站：yezi.me\n\n"));
  assert.ok(message.text.includes('href="https://yezi.me/admin/comments"'));
  assert.ok(message.text.includes("&lt;author&gt;"));
  assert.equal(message.parse_mode, "HTML");
  assert.equal((await checkAndNotifyQQMusicHealth()).notified, true);
  assert.match(calls.at(-1).body.text, /^网站：yezi\.me[\s\S]*QQ 音乐需要处理/);
  updates = [{ update_id: 1, message: { date: Math.floor(Date.now() / 1000), from: { id: 123 }, chat: { id: 123, type: "private" }, text: "/dashboard" } }];
  await processTelegramBotUpdates();
  assert.ok(calls.at(-1).body.text.startsWith("网站：yezi.me\n\n"));
  assert.ok(calls.at(-1).body.text.includes('href="https://yezi.me/admin"'));
  await telegram.sendTelegramTestNotification();
  assert.ok(calls.at(-1).body.text.startsWith("网站：yezi.me\n\n"));
  await telegram.sendTelegramPhoto("123", "data:image/png;base64,aGVsbG8=", "扫码登录");
  assert.equal(calls.at(-1).method, "sendPhoto");
  assert.equal(calls.at(-1).body.get("caption"), "网站：yezi.me\n\n扫码登录");
  await telegram.answerTelegramCallback("callback", "操作完成");
  assert.equal(calls.at(-1).body.text, "[yezi.me] 操作完成");
  assert.equal((await updateSiteSettings({ site_url: "https://new.example:8443" })).ok, true);
  await telegram.sendTelegramMessage("message".repeat(1000));
  assert.ok(calls.at(-1).body.text.startsWith("网站：new.example:8443\n\n"));
  assert.ok(calls.at(-1).body.text.length <= 3800);
  await telegram.sendTelegramPhoto("123", "data:image/png;base64,aGVsbG8=", "x".repeat(1000));
  assert.ok(calls.at(-1).body.get("caption").startsWith("网站：new.example:8443\n\n"));
  assert.ok(calls.at(-1).body.get("caption").length <= 900);
  await telegram.answerTelegramCallback("callback", "x".repeat(300));
  assert.ok(calls.at(-1).body.text.startsWith("[new.example:8443] "));
  assert.ok(calls.at(-1).body.text.length <= 180);
});

test("runtime installation fallback is read afresh and invalid legacy configuration is tolerated", () => {
  setSiteSettings({ site_url: "" });
  process.env.NEXT_PUBLIC_SITE_URL = "https://runtime.example";
  assert.equal(getSiteUrl(), "https://runtime.example");
  setSiteSettings({ site_url: "invalid" });
  assert.equal(getSiteUrl(), "https://runtime.example");
  process.env.NEXT_PUBLIC_SITE_URL = "invalid";
  assert.equal(getSiteUrl(), "http://localhost:3030");
  setSiteSettings({ backup_site_id: "invalid", backup_site_labels: "invalid JSON" });
  const repaired = getBackupSiteIdentity();
  assert.deepEqual(repaired.siteLabels, ["localhost-3030"]);
  assert.match(repaired.siteId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(getBackupSiteIdentity(), repaired);
});
