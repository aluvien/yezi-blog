import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-comments-"));
process.env.BLOG_DB_PATH = path.join(tmpDir, "test.db");
process.env.BLOG_ROOT = tmpDir;
process.env.TRUST_PROXY = "true";

const { db, createComment, createPost, getComment, lastCommentAgeByIp } = await import("../src/lib/db.ts");
const { validateCommentInput } = await import("../src/lib/comment-validation.ts");

db.prepare("INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, ?)").run(
  "telegram_comment_notifications_enabled",
  "0",
  new Date().toISOString(),
);
const post = createPost({ title: "评论测试", content: "内容", status: "published" });

function validPayload(overrides = {}) {
  return {
    target_type: "post",
    target_id: post.id,
    nickname: "访客",
    email: "visitor@example.com",
    website_url: "https://example.com",
    content: "这是一条正常评论",
    ...overrides,
  };
}

test.after(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("valid comment is pending and stores a hashed rate-limit key", () => {
  const validation = validateCommentInput(validPayload(), () => true);
  assert.equal(validation.kind, "valid");
  if (validation.kind !== "valid") return;
  const saved = createComment({
    target_type: validation.input.targetType,
    target_id: validation.input.targetId,
    nickname: validation.input.nickname,
    email: validation.input.email,
    website: validation.input.website,
    content: validation.input.content,
    ip: "203.0.113.80",
  });
  assert.equal(saved.status, "pending");
  assert.match(saved.ip, /^[0-9a-f]{64}$/);
  assert.notEqual(saved.ip, "203.0.113.80");
  assert.equal(saved.ip_address, saved.ip);
  assert.equal(getComment(saved.id)?.id, saved.id);
});

test("comment validation rejects invalid targets and visitor fields", () => {
  const cases = [
    [validPayload({ target_id: 99999 }), "评论对象不存在"],
    [validPayload({ nickname: "" }), "请填写昵称"],
    [validPayload({ email: "not-an-email" }), "邮箱格式不正确"],
    [validPayload({ website_url: "javascript:alert(1)" }), "网站地址不正确"],
    [validPayload({ content: "" }), "请填写评论内容"],
  ];
  for (const [payload, message] of cases) {
    const result = validateCommentInput(payload, (_targetType, targetId) => targetId === post.id);
    assert.equal(result.kind, "invalid");
    if (result.kind === "invalid") assert.match(result.error, new RegExp(message));
  }
});

test("honeypot bypasses all visitor field validation without creating input data", () => {
  assert.deepEqual(validateCommentInput({ website: "https://bot.example" }, () => false), { kind: "honeypot" });
});

test("comment rate-limit lookup uses the same hashed client key as persisted comments", () => {
  const ip = "198.51.100.102";
  createComment({ target_type: "post", target_id: post.id, nickname: "rate", content: "first rate comment", ip });
  assert.ok((lastCommentAgeByIp(ip) ?? Number.POSITIVE_INFINITY) < 30_000);
});
