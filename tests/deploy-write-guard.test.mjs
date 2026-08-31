import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { isDeploymentWriteHoldActive } from "../src/lib/deploy-write-guard.ts";
import { proxy } from "../src/proxy.ts";

test("deployment write hold requires both the explicit flag and its private guard file", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-deploy-write-hold-"));
  const guard = path.join(root, "write-hold");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(isDeploymentWriteHoldActive({ BLOG_DEPLOY_WRITE_HOLD: "true", BLOG_DEPLOY_WRITE_GUARD_FILE: guard }), false);
  fs.writeFileSync(guard, "candidate\n", { mode: 0o600 });
  assert.equal(isDeploymentWriteHoldActive({ BLOG_DEPLOY_WRITE_HOLD: "true", BLOG_DEPLOY_WRITE_GUARD_FILE: guard }), true);
  assert.equal(isDeploymentWriteHoldActive({ BLOG_DEPLOY_WRITE_HOLD: "false", BLOG_DEPLOY_WRITE_GUARD_FILE: guard }), false);
  assert.equal(isDeploymentWriteHoldActive({ BLOG_DEPLOY_WRITE_HOLD: "true" }), false);
});

test("write hold blocks mutations and known write-on-GET routes but keeps deploy health readable", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-deploy-proxy-hold-"));
  const guard = path.join(root, "write-hold");
  const previous = {
    hold: process.env.BLOG_DEPLOY_WRITE_HOLD,
    guard: process.env.BLOG_DEPLOY_WRITE_GUARD_FILE,
  };
  fs.writeFileSync(guard, "candidate\n", { mode: 0o600 });
  process.env.BLOG_DEPLOY_WRITE_HOLD = "true";
  process.env.BLOG_DEPLOY_WRITE_GUARD_FILE = guard;
  t.after(() => {
    if (previous.hold === undefined) delete process.env.BLOG_DEPLOY_WRITE_HOLD;
    else process.env.BLOG_DEPLOY_WRITE_HOLD = previous.hold;
    if (previous.guard === undefined) delete process.env.BLOG_DEPLOY_WRITE_GUARD_FILE;
    else process.env.BLOG_DEPLOY_WRITE_GUARD_FILE = previous.guard;
    fs.rmSync(root, { recursive: true, force: true });
  });

  assert.equal(proxy(new NextRequest("http://localhost/api/v1/interactions", { method: "POST" })).status, 503);
  assert.equal(proxy(new NextRequest("http://localhost/api/music/qq?id=Song1234&type=metadata")).status, 503);
  assert.equal(proxy(new NextRequest("http://localhost/admin/settings")).status, 503);
  assert.equal(proxy(new NextRequest("http://localhost/api/health/deploy")).status, 200);
});
