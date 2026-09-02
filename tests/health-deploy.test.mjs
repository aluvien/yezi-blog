import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-health-"));
process.env.BLOG_ROOT = tempRoot;
process.env.BLOG_DB_PATH = path.join(tempRoot, "data", "blog.db");

const { LATEST_DB_SCHEMA_VERSION, db } = await import("../src/lib/db.ts");
const { GET } = await import("../src/app/api/health/deploy/route.ts");

test.after(() => {
  db.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

function request(headers = {}) {
  return GET(new Request("http://127.0.0.1:3030/api/health/deploy", { headers }));
}

test("public surface stays read-only: no write transaction without the deploy token", async () => {
  const anonymous = await request();
  assert.equal(anonymous.status, 200);
  const body = await anonymous.json();
  assert.equal(body.status, "ok");
  assert.equal(body.writeProbe, "read_only_surface", "公网请求不得触发 BEGIN IMMEDIATE 写锁探针");

  const wrongToken = await request({ "x-deploy-probe-token": "wrong-token-value" });
  assert.equal((await wrongToken.json()).writeProbe, "read_only_surface");

  process.env.DEPLOY_PROBE_TOKEN = "deploy-worker-one-time-token";
  try {
    const authorized = await request({ "x-deploy-probe-token": "deploy-worker-one-time-token" });
    assert.equal((await authorized.json()).writeProbe, "passed", "持有正确 token 的部署 worker 必须拿到写事务证明");
    assert.equal((await (await request({ "x-deploy-probe-token": "stale" })).json()).writeProbe, "read_only_surface");
  } finally {
    delete process.env.DEPLOY_PROBE_TOKEN;
  }
});

test("unsupported future schema and unwritable paths fail the probe with an actionable reason", async () => {
  const originalVersion = db.pragma("user_version", { simple: true });
  db.pragma(`user_version = ${LATEST_DB_SCHEMA_VERSION + 1}`);
  try {
    const response = await request();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "unsupported_schema");
  } finally {
    db.pragma(`user_version = ${originalVersion}`);
  }

  const blockedRoot = path.join(tempRoot, "blocked");
  fs.mkdirSync(path.join(blockedRoot, "data"), { recursive: true });
  fs.chmodSync(path.join(blockedRoot, "data"), 0o500);
  const previousRoot = process.env.BLOG_ROOT;
  process.env.BLOG_ROOT = blockedRoot;
  try {
    const response = await request();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "uploads_not_writable");
  } finally {
    process.env.BLOG_ROOT = previousRoot;
    fs.chmodSync(path.join(blockedRoot, "data"), 0o700);
  }

  const dbFile = path.join(tempRoot, "data", "blog.db");
  fs.chmodSync(dbFile, 0o444);
  try {
    const response = await request();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).reason, "database_not_writable");
  } finally {
    fs.chmodSync(dbFile, 0o600);
  }

  process.env.BLOG_BUILD_READONLY = "true";
  try {
    const readonly = await request();
    assert.equal((await readonly.json()).writeProbe, "skipped_readonly");
  } finally {
    delete process.env.BLOG_BUILD_READONLY;
  }
});
