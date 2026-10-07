import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { syncLatestGithub, getGithubDeployStatus } = await import("../src/lib/admin/deploy.ts");

function setup(context, payload = [{ name: "yezi-blog" }]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-pm2-preflight-"));
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  const bin = path.join(root, "bin", "pm2");
  fs.mkdirSync(path.dirname(bin));
  fs.writeFileSync(bin, `#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(payload))});\n`, { mode: 0o700 });
  const previousEnv = { ...process.env };
  process.env.DEPLOY_PROJECT_DIR = root;
  process.env.DEPLOY_PM2_NAME = "yezi-blog";
  process.env.DEPLOY_PM2_BIN = bin;
  process.env.PATH = "/missing/shell/path";
  process.env.BLOG_ENV_FILE = path.join(root, "private.env");
  process.env.BLOG_ROOT = root;
  process.env.DEPLOY_RELEASES_DIR = path.join(root, "releases");
  delete process.env.DEPLOY_RESTART_MODE;
  context.after(() => {
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    fs.rmSync(root, { recursive: true, force: true });
  });
  return { root, bin };
}

test("PM2 preflight succeeds with a missing shell PATH and retains environment-file checks", async (context) => {
  setup(context);
  const result = await syncLatestGithub();
  assert.equal(result.ok, false);
  assert.match(result.error, /缺少稳定外部环境文件/);
  assert.doesNotMatch(result.error, /ENOENT|PM2 进程状态/);
});

test("missing configured PM2, malformed lists and unmatched process names cancel deployment", async (context) => {
  const { root, bin } = setup(context);
  process.env.DEPLOY_PM2_BIN = path.join(root, "missing-pm2");
  assert.match((await syncLatestGithub()).error, /DEPLOY_PM2_BIN.*已取消部署/);
  process.env.DEPLOY_PM2_BIN = bin;
  fs.writeFileSync(bin, '#!/usr/bin/env node\nconsole.log("not JSON");\n');
  assert.match((await syncLatestGithub()).error, /PM2 jlist.*已取消部署/);
  fs.writeFileSync(bin, '#!/usr/bin/env node\nconsole.log("[]");\n');
  assert.match((await syncLatestGithub()).error, /未找到配置的进程/);
  assert.equal(fs.existsSync(path.join(root, "data", "deploy-status.json")), false);
});

test("the discovered PM2 CLI and Node PATH are forwarded to the detached deployment launcher", async (context) => {
  const { root, bin } = setup(context);
  const captured = path.join(root, "launcher.json");
  fs.writeFileSync(process.env.BLOG_ENV_FILE, "ADMIN_PASSWORD=test\n", { mode: 0o600 });
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts", "deploy-in-place.mjs"), "");
  fs.writeFileSync(path.join(root, "scripts", "launch-detached-deploy.mjs"), `
    import fs from "node:fs";
    import { execFileSync } from "node:child_process";
    fs.writeFileSync(${JSON.stringify(captured)}, JSON.stringify({
      bin: process.env.DEPLOY_PM2_BIN,
      name: process.env.DEPLOY_PM2_NAME,
      mode: process.env.DEPLOY_RESTART_MODE,
      path: process.env.PATH,
      orphan: process.env.DEPLOY_REQUIRE_ORPHAN,
      legacyPm2List: JSON.parse(execFileSync("pm2", ["jlist"], { encoding: "utf8" })),
    }));
  `);
  const result = await syncLatestGithub();
  assert.equal(result.ok, true);
  const launchEnv = JSON.parse(fs.readFileSync(captured, "utf8"));
  assert.equal(launchEnv.bin, fs.realpathSync(bin));
  assert.equal(launchEnv.name, "yezi-blog");
  assert.equal(launchEnv.mode, "pm2");
  assert.equal(launchEnv.path.split(path.delimiter)[0], path.dirname(process.execPath));
  assert.equal(launchEnv.orphan, "1");
  assert.deepEqual(launchEnv.legacyPm2List, [{ name: "yezi-blog" }]);
  assert.equal((await getGithubDeployStatus()).status, "queued");
});

test("invalid deployment directories fail before any PM2 or deployment operation", async (context) => {
  const { root } = setup(context);
  process.env.DEPLOY_PROJECT_DIR = path.join(root, "missing");
  assert.match((await syncLatestGithub()).error, /部署目录无效/);
});
