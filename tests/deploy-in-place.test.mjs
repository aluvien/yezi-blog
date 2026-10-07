import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { deployInPlace, runDeploymentCommand } from "../scripts/deploy-in-place.mjs";

const fakeServer = `
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
const project = process.env.BLOG_ROOT;
const broken = process.env.TEST_HEALTH_FAIL === "true" && process.env.PORT === process.env.TEST_PUBLIC_PORT && fs.readFileSync(path.join(project, ".next", "version"), "utf8") === "new";
http.createServer((req, res) => {
  if (req.url === "/api/health/deploy") {
    res.setHeader("content-type", "application/json");
    res.statusCode = broken ? 503 : 200;
    const marker = path.join(project, "data", "deploy-commit");
    res.end(JSON.stringify({status: broken ? "error" : "ok", commit: fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim() : "development"}));
  } else if (req.url === "/") {
    res.setHeader("content-security-policy", "script-src 'nonce-test'");
    res.end('<script src="/_next/static/chunks/site.js"></script>');
  } else {
    res.setHeader("content-type", "application/javascript");
    res.end("console.log('site')");
  }
}).listen(Number(process.env.PORT), "127.0.0.1");
`;

async function unusedPort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fixture(t) {
  const temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "yezi-in-place-")));
  const root = path.join(temporary, "project");
  const remote = path.join(temporary, "remote.git");
  const bin = path.join(temporary, "bin");
  fs.mkdirSync(root); fs.mkdirSync(bin);
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Deployment Test");
  git("init", "--bare", remote);
  git("remote", "add", "origin", remote);
  fs.writeFileSync(path.join(root, ".gitignore"), "data/\n.next/\nnode_modules/\n.env.local\n");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module", version: "old" }));
  fs.mkdirSync(path.join(root, "scripts"));
  fs.writeFileSync(path.join(root, "scripts", "start-standalone.mjs"), fakeServer);
  git("add", "."); git("commit", "-m", "old");
  const old = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ type: "module", version: "new" }));
  git("add", "."); git("commit", "-m", "new");
  const latest = git("rev-parse", "HEAD");
  git("push", "origin", "main");
  git("reset", "--hard", old);
  fs.mkdirSync(path.join(root, "data"));
  fs.mkdirSync(path.join(root, ".next", "standalone"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, ".next", "standalone", "server.js"), fakeServer);
  fs.writeFileSync(path.join(root, ".next", "version"), "old");
  fs.writeFileSync(path.join(root, "node_modules", "version"), "old");
  fs.writeFileSync(path.join(root, "data", "blog.db"), "original database");
  fs.writeFileSync(path.join(root, "data", "deploy-commit"), `${old}\n`);
  fs.writeFileSync(path.join(root, ".env.local"), "DEPLOY_PM2_NAME=yezi-blog\nADMIN_PASSWORD=test\nNEXT_PUBLIC_SITE_URL=https://example.invalid\nTRUST_PROXY=true\nSESSION_COOKIE_SECURE=true\n", { mode: 0o600 });
  fs.mkdirSync(path.join(root, ".well-known"));
  fs.writeFileSync(path.join(root, ".well-known", "challenge"), "keep");
  const events = path.join(temporary, "events.jsonl");
  const pm2State = path.join(temporary, "pm2.json");
  const port = await unusedPort();
  const env = {
    ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    DEPLOY_PROJECT_DIR: root, BLOG_ROOT: root, BLOG_ENV_FILE: path.join(root, ".env.local"),
    PM2_HOME: path.join(temporary, "pm2-home"), DEPLOY_PM2_BIN: path.join(bin, "pm2"),
    DEPLOY_HEALTH_URL: `http://127.0.0.1:${port}/api/health/deploy`, PORT: String(port),
    TEST_STATE: pm2State, TEST_EVENTS: events, TEST_PROJECT: root, TEST_PUBLIC_PORT: String(port),
    DEPLOY_RELEASES_DIR: "/unwritable/unused-release-directory", DEPLOY_CURRENT_LINK: "/unwritable/unused-current",
  };
  for (const key of ["BLOG_DB_PATH", "DEPLOY_REQUIRE_ORPHAN", "DEPLOY_STATUS_FILE", "DEPLOY_RESTART_MODE", "DEPLOY_PM2_NAME"]) delete env[key];
  const original = spawn(process.execPath, [path.join(root, ".next", "standalone", "server.js")], { cwd: root, env, stdio: "ignore" });
  fs.writeFileSync(pm2State, JSON.stringify({ pid: original.pid, status: "online" }));
  fs.writeFileSync(path.join(bin, "pm2"), `#!/usr/bin/env node
const fs = require("node:fs"), path = require("node:path");
const {spawn} = require("node:child_process");
const root = process.env.TEST_PROJECT, file = process.env.TEST_STATE;
let state = JSON.parse(fs.readFileSync(file));
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TEST_EVENTS, JSON.stringify({command:"pm2", args, home:process.env.PM2_HOME}) + "\\n");
if(args[0] === "jlist") {
 console.log(JSON.stringify([{name:"yezi-blog",pid:state.pid,pm2_env:{status:state.status,watch:state.watch,pm_cwd:state.cwd||path.join(root,".next","standalone"),pm_exec_path:path.join(root,".next","standalone","server.js")}}]));
} else if(args[0] === "stop") {
 if(state.pid > 0) { try { process.kill(state.pid,"SIGTERM"); } catch {} }
 state={pid:0,status:"stopped"}; fs.writeFileSync(file,JSON.stringify(state));
} else if(args[0] === "restart") {
 if(process.env.TEST_RESTART_FAIL === "true" && fs.readFileSync(path.join(root,".next","version"),"utf8")==="new") process.exit(1);
 const child=spawn(process.execPath,[path.join(root,".next","standalone","server.js")],{cwd:root,env:process.env,detached:true,stdio:"ignore"});
 child.unref(); state={pid:child.pid,status:"online"};fs.writeFileSync(file,JSON.stringify(state));
 if(process.env.TEST_MIGRATE === "true" && fs.readFileSync(path.join(root,".next","version"),"utf8")==="new") fs.writeFileSync(path.join(root,"data","blog.db"),"migrated");
} else if(args[0] === "save") { if(process.env.TEST_SAVE_FAIL === "true") process.exit(1); }
else { process.exit(2); }
`, { mode: 0o700 });
  fs.writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path");
const args=process.argv.slice(2), root=process.cwd();
fs.appendFileSync(process.env.TEST_EVENTS,JSON.stringify({command:"npm",args,readonly:process.env.BLOG_BUILD_READONLY,cache:process.env.npm_config_cache,upperCache:process.env.NPM_CONFIG_CACHE})+"\\n");
if(args[1]==="backup") {
 fs.mkdirSync(process.env.BLOG_BACKUP_DIR,{recursive:true});fs.copyFileSync(process.env.BLOG_DB_PATH,path.join(process.env.BLOG_BACKUP_DIR,"blog-test.db"));
} else if(args[0]==="ci") {
 if(process.env.TEST_INSTALL_FAIL==="true") process.exit(1);
 fs.mkdirSync(path.join(root,"node_modules"));fs.writeFileSync(path.join(root,"node_modules","version"),"new");
} else if(args[1]==="build") {
 if(process.env.TEST_BUILD_FAIL==="true") process.exit(1);
 fs.mkdirSync(path.join(root,".next","standalone"),{recursive:true});
 fs.copyFileSync(path.join(root,"scripts","start-standalone.mjs"),path.join(root,".next","standalone","server.js"));
 fs.writeFileSync(path.join(root,".next","version"),"new");
} else process.exit(2);
`, { mode: 0o700 });
  t.after(async () => {
    const state = JSON.parse(fs.readFileSync(pm2State));
    if (state.pid) { try { process.kill(state.pid, "SIGTERM"); } catch {} }
    if (original.exitCode === null && original.signalCode === null) {
      const exited = once(original, "exit"); original.kill("SIGTERM"); await exited;
    }
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(env.DEPLOY_HEALTH_URL)).ok) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return { root, env, old, latest, git, events: () => fs.readFileSync(events, "utf8").trim().split("\n").map((line) => JSON.parse(line)) };
}

function deploy(env) { return deployInPlace({ env, healthAttempts: 40, healthInterval: 25, npmCommand: path.join(path.dirname(env.DEPLOY_PM2_BIN), "npm") }); }

test("terminal update fast-forwards main, rebuilds in place and restarts the existing standalone PM2 process", async (t) => {
  const f = await fixture(t);
  await deploy(f.env);
  assert.equal(f.git("rev-parse", "HEAD"), f.latest);
  assert.equal(fs.readFileSync(path.join(f.root, "data", "deploy-commit"), "utf8").trim(), f.latest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "data", "deploy-status.json"))).status, "success");
  assert.equal(fs.readFileSync(path.join(f.root, ".well-known", "challenge"), "utf8"), "keep");
  const events = f.events();
  assert.deepEqual(events.filter((e) => e.command === "npm").map((e) => e.args.slice(0, 2)), [["run", "backup"], ["ci", "--cache"], ["run", "build"]]);
  assert.equal(events.find((e) => e.args[1] === "build").readonly, "true");
  assert.deepEqual(events.filter((e) => e.command === "pm2" && e.args[0] !== "jlist").map((e) => e.args[0]), ["stop", "restart", "save"]);
  assert.ok(events.filter((e) => e.command === "pm2").every((e) => e.home === f.env.PM2_HOME));
  assert.ok(!fs.readdirSync(path.join(f.root, "data")).some((name) => name.startsWith(".deploy")));
});

test("all deployment npm commands override a root-owned panel cache with the private project cache", async (t) => {
  const f = await fixture(t);
  const sharedCache = path.join(path.dirname(f.root), "shared-panel-cache");
  fs.mkdirSync(sharedCache);
  fs.writeFileSync(path.join(sharedCache, "preserved"), "panel state");
  fs.chmodSync(sharedCache, 0o500);
  try {
    await deploy({ ...f.env, npm_config_cache: sharedCache, NPM_CONFIG_CACHE: sharedCache });
    const cache = path.join(f.root, "data", "npm-cache");
    const npmEvents = f.events().filter((event) => event.command === "npm");
    assert.ok(npmEvents.every((event) => event.cache === cache && event.upperCache === cache));
    assert.deepEqual(npmEvents.find((event) => event.args[0] === "ci").args.slice(0, 3), ["ci", "--cache", cache]);
    assert.equal(fs.statSync(cache).mode & 0o777, 0o700);
    assert.equal(fs.statSync(sharedCache).mode & 0o777, 0o500);
    assert.equal(fs.readFileSync(path.join(sharedCache, "preserved"), "utf8"), "panel state");
  } finally { fs.chmodSync(sharedCache, 0o700); }
});

test("a cache-path failure is reported before stopping PM2 or changing source", async (t) => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.root, "data", "npm-cache"), "not a directory");
  await assert.rejects(deploy(f.env), /EEXIST|ENOTDIR/);
  assert.equal(f.git("rev-parse", "HEAD"), f.old);
  assert.equal(fs.existsSync(path.join(path.dirname(f.root), "events.jsonl")), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "data", "deploy-status.json"))).status, "failed");
});

for (const failure of ["TEST_INSTALL_FAIL", "TEST_BUILD_FAIL", "TEST_RESTART_FAIL", "TEST_HEALTH_FAIL"]) {
  test(`${failure} restores old artifacts and version, preserving database and untracked files`, async (t) => {
    const f = await fixture(t);
    await assert.rejects(deploy({ ...f.env, [failure]: "true", TEST_MIGRATE: "true" }), /已恢复旧构建/);
    assert.equal(fs.readFileSync(path.join(f.root, ".next", "version"), "utf8"), "old");
    assert.equal(fs.readFileSync(path.join(f.root, "node_modules", "version"), "utf8"), "old");
    assert.equal(fs.readFileSync(path.join(f.root, "data", "blog.db"), "utf8"), "original database");
    assert.equal(fs.readFileSync(path.join(f.root, "data", "deploy-commit"), "utf8").trim(), f.old);
    assert.equal(f.git("rev-parse", "HEAD"), f.latest);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "data", "deploy-status.json"))).status, "failed");
    assert.equal(fs.existsSync(path.join(f.root, "data", ".deploy.lock")), false);
  });
}

test("branch, dirty-source and concurrent-update guards run before touching PM2 or dependencies", async (t) => {
  const f = await fixture(t);
  f.git("switch", "--detach");
  await assert.rejects(deploy(f.env), /当前分支不是 main/);
  f.git("switch", "main");
  fs.appendFileSync(path.join(f.root, "package.json"), " ");
  await assert.rejects(deploy(f.env), /未提交的源码改动/);
  fs.writeFileSync(path.join(f.root, "data", ".deploy.lock"), "another worker");
  const priorStatus = fs.readFileSync(path.join(f.root, "data", "deploy-status.json"), "utf8");
  await assert.rejects(deploy(f.env), /已有一次部署/);
  assert.equal(fs.readFileSync(path.join(f.root, "data", "deploy-status.json"), "utf8"), priorStatus);
  assert.equal(fs.readFileSync(path.join(f.root, "data", ".deploy.lock"), "utf8"), "another worker");
  assert.equal(fs.existsSync(path.join(path.dirname(f.root), "events.jsonl")), false);
});

test("environment permissions and required configuration fail without stopping the site", async (t) => {
  const f = await fixture(t);
  fs.chmodSync(f.env.BLOG_ENV_FILE, 0o644);
  await assert.rejects(deploy(f.env), /0600/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "data", "deploy-status.json"))).status, "failed");
  fs.chmodSync(f.env.BLOG_ENV_FILE, 0o600);
  const contents = fs.readFileSync(f.env.BLOG_ENV_FILE, "utf8");
  for (const [bad, reason] of [
    [contents.replace("ADMIN_PASSWORD=test", "ADMIN_PASSWORD="), /ADMIN_PASSWORD/],
    [contents.replace("https://example.invalid", "file:///private"), /NEXT_PUBLIC_SITE_URL/],
    [contents.replace("TRUST_PROXY=true", "TRUST_PROXY=false"), /TRUST_PROXY/],
  ]) {
    fs.writeFileSync(f.env.BLOG_ENV_FILE, bad);
    await assert.rejects(deploy(f.env), reason);
  }
  assert.equal(fs.existsSync(path.join(path.dirname(f.root), "events.jsonl")), false);
});

test("unrelated, stopped and watched PM2 processes are rejected before any stop", async (t) => {
  const f = await fixture(t);
  const stateFile = f.env.TEST_STATE;
  const original = JSON.parse(fs.readFileSync(stateFile));
  for (const [patch, reason] of [
    [{ cwd: path.dirname(f.root) }, /不属于当前项目/],
    [{ status: "stopped" }, /正在运行/],
    [{ watch: true }, /watch/],
  ]) {
    fs.writeFileSync(stateFile, JSON.stringify({ ...original, ...patch }));
    await assert.rejects(deploy(f.env), reason);
  }
  fs.writeFileSync(stateFile, JSON.stringify(original));
  assert.ok(f.events().every((e) => e.args[0] === "jlist"));
});

test("a PM2 save failure after successful activation never rolls back user writes", async (t) => {
  const f = await fixture(t);
  await deploy({ ...f.env, TEST_SAVE_FAIL: "true" });
  assert.equal(fs.readFileSync(path.join(f.root, "data", "deploy-commit"), "utf8").trim(), f.latest);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, "data", "deploy-status.json"))).status, "success");
  assert.equal(f.events().filter((e) => e.args[0] === "restart").length, 1);
});

test("a timed-out build kills descendants before rollback can restore artifacts", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-deploy-timeout-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const lateWrite = path.join(root, "late-build-write");
  const childPid = path.join(root, "child-pid");
  const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');
    const child=spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(lateWrite)},'corrupted'),500)`)}],{stdio:'inherit'});
    fs.writeFileSync(${JSON.stringify(childPid)},String(child.pid));setTimeout(()=>{},2000);`;
  await assert.rejects(runDeploymentCommand(process.execPath, ["-e", code], root, process.env, 200), /命令超时/);
  await new Promise((resolve) => setTimeout(resolve, 550));
  assert.equal(fs.existsSync(lateWrite), false);
  assert.equal(fs.existsSync(childPid), true);
});
