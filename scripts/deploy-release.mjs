import { execFile } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const sourceRoot = path.resolve(process.env.DEPLOY_PROJECT_DIR || process.cwd());
const stateRoot = path.resolve(process.env.BLOG_ROOT || sourceRoot);
const databasePath = path.resolve(process.env.BLOG_DB_PATH || path.join(stateRoot, "data", "blog.db"));
const releasesRoot = path.resolve(process.env.DEPLOY_RELEASES_DIR || path.join(path.dirname(sourceRoot), "yezi-blog-releases"));
const currentLink = path.resolve(process.env.DEPLOY_CURRENT_LINK || path.join(path.dirname(sourceRoot), "yezi-blog-current"));
const processName = process.env.DEPLOY_PM2_NAME?.trim() || "yezi-blog";
const restartMode = process.env.DEPLOY_RESTART_MODE === "direct" ? "direct" : "pm2";
const envFile = path.resolve(process.env.BLOG_ENV_FILE?.trim() || path.join(sourceRoot, ".env.local"));
const statusFile = path.resolve(process.env.DEPLOY_STATUS_FILE || path.join(stateRoot, "data", "deploy-status.json"));
const lockFile = path.join(releasesRoot, ".deploy.lock");
const finalHealthUrl = process.env.DEPLOY_HEALTH_URL?.trim() || "http://127.0.0.1:3030/api/health/deploy";
const keepReleases = Math.max(2, Math.min(10, Number.parseInt(process.env.DEPLOY_KEEP_RELEASES || "3", 10) || 3));

async function relaunchDetachedWorker() {
  const self = fileURLToPath(import.meta.url);
  const launcher = path.join(path.dirname(self), "launch-detached-deploy.mjs");
  const logFile = path.resolve(process.env.DEPLOY_LOG_FILE || path.join(path.dirname(statusFile), "deploy-release.log"));
  await new Promise((resolve, reject) => {
    execFile(process.execPath, [launcher, self], {
      cwd: sourceRoot,
      env: {
        ...process.env,
        DEPLOY_PROJECT_DIR: sourceRoot,
        DEPLOY_LOG_FILE: logFile,
      },
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    }, (error) => error ? reject(error) : resolve());
  });
}

async function waitUntilOrphaned() {
  if (process.env.DEPLOY_REQUIRE_ORPHAN !== "1") return;
  if (process.env.DEPLOY_ORPHAN_WORKER !== "1") {
    throw new Error("部署任务未经过独立启动器，已取消 PM2 切换");
  }
  const launcherPid = Number.parseInt(process.env.DEPLOY_LAUNCHER_PID || "", 10);
  if (!Number.isInteger(launcherPid) || launcherPid < 2) throw new Error("独立启动器 PID 无效");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (process.ppid !== launcherPid) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("部署任务未能脱离网站进程树，已取消 PM2 切换");
}

function readStableEnvironment(filePath) {
  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const rawValue = match[2].trim();
    values[match[1]] = ((rawValue.startsWith('"') && rawValue.endsWith('"')) || (rawValue.startsWith("'") && rawValue.endsWith("'")))
      ? rawValue.slice(1, -1)
      : rawValue;
  }
  if (!values.ADMIN_PASSWORD?.trim()) throw new Error("稳定外部环境文件缺少 ADMIN_PASSWORD");
  try {
    const site = new URL(values.NEXT_PUBLIC_SITE_URL || "");
    if (site.protocol !== "http:" && site.protocol !== "https:") throw new Error();
  } catch {
    throw new Error("稳定外部环境文件缺少有效的 NEXT_PUBLIC_SITE_URL");
  }
  return values;
}

function writeStatus(status, extra = {}) {
  fs.mkdirSync(path.dirname(statusFile), { recursive: true, mode: 0o700 });
  const payload = { status, updatedAt: new Date().toISOString(), ...extra };
  const temporary = `${statusFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, statusFile);
  fs.chmodSync(statusFile, 0o600);
  process.stdout.write(`[deploy] ${JSON.stringify(payload)}\n`);
}

// Backward-compatible safety for the first rollout of the launcher: an older
// running release still invokes this script directly. Bootstrap a real orphan
// and let this temporary child exit before any build or PM2 operation begins.
if (process.env.DEPLOY_ORPHAN_WORKER !== "1") {
  try {
    await relaunchDetachedWorker();
  } catch (error) {
    writeStatus("failed", { error: `无法脱离网站进程树：${error instanceof Error ? error.message : error}` });
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
}

function run(command, args, cwd = sourceRoot, timeout = 300_000, env = process.env) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, timeout, env, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = String(stderr || stdout || error.message).trim().slice(-2_000);
        reject(new Error(`${command} ${args[0] || ""} failed${detail ? `: ${detail}` : ""}`));
        return;
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function reservePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!address || typeof address === "string") throw new Error("无法分配 smoke 端口");
  return address.port;
}

async function verifyHttp(baseUrl, commit, attempts = 80, requireCommit = true) {
  let lastError = "尚未监听";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const health = await fetch(baseUrl, { cache: "no-store", signal: AbortSignal.timeout(1_500) });
      const payload = await health.json();
      if (!health.ok || payload?.status !== "ok" || (requireCommit && payload?.commit !== commit)) {
        const actualCommit = typeof payload?.commit === "string" ? `（实际 ${payload.commit.slice(0, 12)}）` : "";
        throw new Error(`health ${health.status}${actualCommit}`);
      }
      const origin = new URL(baseUrl).origin;
      const home = await fetch(`${origin}/`, { cache: "no-store", signal: AbortSignal.timeout(2_000) });
      const csp = home.headers.get("content-security-policy") || "";
      const html = await home.text();
      if (!home.ok || !csp.includes("nonce-") || (requireCommit && !html.includes(commit.slice(0, 7)))) throw new Error("首页/build commit 校验失败");
      const chunkPath = html.match(/\/_next\/static\/chunks\/[^"']+\.js/)?.[0];
      if (!chunkPath) throw new Error("首页没有可验证的 JS chunk");
      const chunk = await fetch(`${origin}${chunkPath}`, { signal: AbortSignal.timeout(2_000) });
      if (!chunk.ok) throw new Error(`JS chunk ${chunk.status}`);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`健康检查失败：${lastError}`);
}

async function smokeRelease(release, commit, env) {
  const port = await reservePort();
  const child = (await import("node:child_process")).spawn(process.execPath, [path.join(release, "scripts", "start-standalone.mjs")], {
    cwd: release,
    env: { ...env, PORT: String(port), HOSTNAME: "127.0.0.1", BLOG_BUILD_READONLY: "true", DEPLOY_BUILD_COMMIT: commit },
    stdio: "ignore",
  });
  try {
    await verifyHttp(`http://127.0.0.1:${port}/api/health/deploy`, commit, 60, false);
  } finally {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}

function switchCurrent(target) {
  if (fs.existsSync(currentLink) && !fs.lstatSync(currentLink).isSymbolicLink()) {
    throw new Error(`current 路径不是软链，拒绝覆盖：${currentLink}`);
  }
  const temporary = `${currentLink}.${process.pid}.tmp`;
  fs.rmSync(temporary, { force: true });
  fs.symlinkSync(target, temporary, "dir");
  fs.renameSync(temporary, currentLink);
}

function latestBackup(beforeNames) {
  const directory = path.join(stateRoot, "data", "backups");
  const candidates = fs.readdirSync(directory)
    .filter((name) => /^blog-.*\.db$/.test(name) && !beforeNames.has(name))
    .map((name) => ({ path: path.join(directory, name), mtime: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  if (!candidates[0]) throw new Error("部署前数据库备份没有生成新文件");
  return candidates[0].path;
}

function restoreDatabase(snapshot) {
  const temporary = `${databasePath}.${process.pid}.restore`;
  fs.copyFileSync(snapshot, temporary);
  fs.chmodSync(temporary, 0o600);
  fs.rmSync(`${databasePath}-wal`, { force: true });
  fs.rmSync(`${databasePath}-shm`, { force: true });
  fs.renameSync(temporary, databasePath);
}

const commitMarkerPath = path.join(stateRoot, "data", "deploy-commit");

function readCommitMarker() {
  try { return fs.readFileSync(commitMarkerPath, "utf8"); } catch { return null; }
}

function writeCommitMarker(commit) {
  const temporary = `${commitMarkerPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${commit}\n`, { mode: 0o600 });
  fs.renameSync(temporary, commitMarkerPath);
  fs.chmodSync(commitMarkerPath, 0o600);
}

function restoreCommitMarker(previous) {
  if (previous === null) {
    fs.rmSync(commitMarkerPath, { force: true });
    return;
  }
  fs.writeFileSync(commitMarkerPath, previous, { mode: 0o600 });
  fs.chmodSync(commitMarkerPath, 0o600);
}

async function verifyPm2Ownership() {
  const processEntry = await readPm2Process(processName);
  if (!processEntry) throw new Error(`PM2 中不存在进程 ${processName}`);
}

/**
 * Some PM2 versions print upgrade notices before/after `jlist` JSON. Treat
 * those notices as transport noise instead of deciding that PM2 is absent.
 */
function parsePm2ProcessList(output) {
  const start = output.indexOf("[");
  const end = output.lastIndexOf("]");
  if (start < 0 || end < start) throw new Error("PM2 jlist 没有返回进程 JSON");
  try {
    const processes = JSON.parse(output.slice(start, end + 1));
    if (!Array.isArray(processes)) throw new Error("not an array");
    return processes;
  } catch {
    throw new Error("PM2 jlist 返回格式无效，已取消部署以避免误杀 PM2 进程");
  }
}

async function readPm2Process(name) {
  const result = await run("pm2", ["jlist"], sourceRoot, 15_000);
  return parsePm2ProcessList(result.stdout).find((item) => item?.name === name) || null;
}

async function verifyPm2Release(target) {
  const processEntry = await readPm2Process(processName);
  if (!processEntry) throw new Error(`PM2 启动后未找到进程 ${processName}`);
  const expectedRoot = fs.realpathSync(target);
  const expectedScript = path.join(expectedRoot, "scripts", "start-standalone.mjs");
  const actualRoot = typeof processEntry.pm2_env?.pm_cwd === "string" ? path.resolve(processEntry.pm2_env.pm_cwd) : "";
  const actualScript = typeof processEntry.pm2_env?.pm_exec_path === "string" ? path.resolve(processEntry.pm2_env.pm_exec_path) : "";
  if (actualRoot !== expectedRoot || actualScript !== expectedScript) {
    throw new Error(`PM2 没有切换到目标 release（cwd: ${actualRoot || "未知"}；script: ${actualScript || "未知"}）`);
  }
}

async function removePm2Process() {
  try {
    await run("pm2", ["delete", processName], sourceRoot, 30_000);
  } catch (error) {
    // A failed first start can leave no PM2 record. Let rollback recreate the
    // previous release, but never ignore an error while the process remains.
    if (await readPm2Process(processName)) throw error;
  }
}

async function portIsListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

/** Direct/nohup deployments have no supervisor. Only target the configured HTTP port. */
async function stopDirectServer() {
  const port = Number.parseInt(new URL(finalHealthUrl).port || "80", 10);
  const result = await run("ss", ["-ltnp", "sport", "=", `:${port}`], sourceRoot, 15_000).catch(() => ({ stdout: "" }));
  const pids = [...new Set([...result.stdout.matchAll(/pid=(\d+)/g)].map((match) => Number(match[1])).filter((pid) => pid > 1 && pid !== process.pid))];
  for (const pid of pids) {
    try { process.kill(pid, "SIGTERM"); } catch { /* Process may already be gone. */ }
  }
  for (let attempt = 0; attempt < 30 && await portIsListening(port); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (await portIsListening(port)) {
    for (const pid of pids) {
      try { process.kill(pid, "SIGKILL"); } catch { /* Process may already be gone. */ }
    }
  }
  for (let attempt = 0; attempt < 20 && await portIsListening(port); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (await portIsListening(port)) throw new Error(`无法停止 ${port} 端口上的旧 Next 进程，已取消切换`);
}

async function startDirectServer(target, env) {
  const child = (await import("node:child_process")).spawn(process.execPath, [path.join(target, "scripts", "start-standalone.mjs")], {
    cwd: target,
    detached: true,
    stdio: "ignore",
    env,
  });
  child.unref();
}

async function restartRelease(target, env) {
  const releaseRoot = fs.realpathSync(target);
  if (restartMode === "pm2") {
    // `startOrReload` retains the old pm_exec_path for an existing app on
    // some PM2 releases. Recreate this one managed process so it always runs
    // the exact immutable release we just built. A failure stays in PM2 mode;
    // never fall back to direct port killing.
    await removePm2Process();
    await run("pm2", ["start", path.join(releaseRoot, "ecosystem.config.js"), "--only", processName, "--update-env"], releaseRoot, 30_000, env);
    await verifyPm2Release(releaseRoot);
    await run("pm2", ["save"], releaseRoot, 30_000, env);
    return;
  }
  await stopDirectServer();
  await startDirectServer(releaseRoot, env);
}

async function cleanupReleases(activeTargets) {
  const directories = fs.readdirSync(releasesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^[0-9a-f]{40}$/i.test(entry.name))
    .map((entry) => ({ path: path.join(releasesRoot, entry.name), mtime: fs.statSync(path.join(releasesRoot, entry.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of directories.filter((item) => !activeTargets.has(path.resolve(item.path))).slice(keepReleases)) {
    await run("git", ["worktree", "remove", "--force", stale.path], sourceRoot, 60_000).catch(() => undefined);
  }
}

let lockFd;
let previousTarget = sourceRoot;
let databaseSnapshot = "";
let switched = false;
let stableEnvironment = {};
let previousCommitMarker = null;
try {
  await waitUntilOrphaned();
  if (!fs.existsSync(envFile)) throw new Error(`缺少稳定外部环境文件：${envFile}`);
  if ((fs.statSync(envFile).mode & 0o077) !== 0) throw new Error(`外部环境文件权限必须为 0600：${envFile}`);
  stableEnvironment = readStableEnvironment(envFile);
  if (!fs.existsSync(databasePath)) throw new Error(`数据库不存在：${databasePath}`);
  fs.mkdirSync(releasesRoot, { recursive: true, mode: 0o700 });
  try {
    lockFd = fs.openSync(lockFile, "wx", 0o600);
  } catch (error) {
    if (error?.code === "EEXIST") throw new Error("已有一次部署正在执行");
    throw error;
  }
  if (restartMode === "pm2") await verifyPm2Ownership();

  writeStatus("building");
  await run("git", ["fetch", "--prune", "origin", "main"], sourceRoot, 120_000);
  const revision = (await run("git", ["rev-parse", "origin/main"], sourceRoot, 15_000)).stdout.trim();
  if (!/^[0-9a-f]{40}$/i.test(revision)) throw new Error("origin/main 提交号无效");
  const release = path.join(releasesRoot, revision);
  if (!fs.existsSync(release)) await run("git", ["worktree", "add", "--detach", release, revision], sourceRoot, 60_000);

  const releaseEnv = {
    ...process.env,
    ...stableEnvironment,
    BLOG_ROOT: stateRoot,
    BLOG_DB_PATH: databasePath,
    BLOG_ENV_FILE: envFile,
    BLOG_BUILD_READONLY: "true",
    DEPLOY_BUILD_COMMIT: revision,
    HOSTNAME: "127.0.0.1",
  };
  await run("npm", ["ci", "--include=dev", "--no-audit", "--no-fund"], release, 300_000, releaseEnv);
  await run("npm", ["run", "build"], release, 300_000, releaseEnv);
  await smokeRelease(release, revision, releaseEnv);

  previousTarget = fs.existsSync(currentLink) ? fs.realpathSync(currentLink) : sourceRoot;
  writeStatus("switching", { commit: revision.slice(0, 7) });
  const backupDirectory = path.join(stateRoot, "data", "backups");
  fs.mkdirSync(backupDirectory, { recursive: true, mode: 0o700 });
  const beforeBackups = new Set(fs.readdirSync(backupDirectory));
  await run("npm", ["run", "backup"], sourceRoot, 120_000, { ...releaseEnv, BLOG_BUILD_READONLY: "false" });
  databaseSnapshot = latestBackup(beforeBackups);

  switchCurrent(release);
  switched = true;
  previousCommitMarker = readCommitMarker();
  writeCommitMarker(revision);
  await restartRelease(currentLink, {
    ...releaseEnv,
    BLOG_BUILD_READONLY: "false",
  });
  writeStatus("checking", { commit: revision.slice(0, 7) });
  await verifyHttp(finalHealthUrl, revision, 120);
  writeStatus("success", { commit: revision.slice(0, 7) });
  await cleanupReleases(new Set([path.resolve(release), path.resolve(previousTarget)]));
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  const lockContended = detail === "已有一次部署正在执行" && lockFd === undefined;
  if (!lockContended && switched && databaseSnapshot) {
    writeStatus("rolling_back", { error: detail });
    try {
      switchCurrent(previousTarget);
      restoreDatabase(databaseSnapshot);
      restoreCommitMarker(previousCommitMarker);
      await restartRelease(previousTarget, {
        ...process.env,
        ...stableEnvironment,
        BLOG_ROOT: stateRoot,
        BLOG_DB_PATH: databasePath,
        BLOG_ENV_FILE: envFile,
        BLOG_BUILD_READONLY: "false",
      });
    } catch (rollbackError) {
      writeStatus("failed", { error: `${detail}；自动回滚也失败：${rollbackError instanceof Error ? rollbackError.message : rollbackError}` });
      process.exitCode = 1;
      throw rollbackError;
    }
  }
  // A near-simultaneous second click must not overwrite the real worker's
  // progress with a false failure state.
  if (!lockContended) writeStatus("failed", { error: detail });
  process.exitCode = 1;
} finally {
  // Never remove another worker's lock. A contender that lost the atomic
  // `wx` race does not own the file and must leave the active deploy protected.
  if (lockFd !== undefined) {
    fs.closeSync(lockFd);
    fs.rmSync(lockFile, { force: true });
  }
}
