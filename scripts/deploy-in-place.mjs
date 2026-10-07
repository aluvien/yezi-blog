import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { deploymentCommandEnv, resolvePm2Command } from "./pm2-command.mjs";

export function runDeploymentCommand(command, args, cwd, env, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", failure, bytes = 0;
    const stop = (reason) => {
      failure = reason;
      // npm/next can have multiple descendants. Killing only npm would let a
      // timed-out build overwrite the artifacts while rollback restores them.
      try { process.kill(-child.pid, "SIGKILL"); }
      catch { child.kill("SIGKILL"); }
    };
    const timer = setTimeout(() => stop(`命令超时：${command} ${args.join(" ")}`), timeout);
    child.stdout.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) stop("命令输出超过限制");
      else stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > 8 * 1024 * 1024) stop("命令输出超过限制");
      else stderr += chunk.toString();
    });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !failure) resolve(stdout);
      else reject(new Error(failure || String(stderr || stdout || `命令失败：${command}`).trim().slice(-2_000)));
    });
  });
}
const run = runDeploymentCommand;

function readEnvironment(file) {
  if ((fs.statSync(file).mode & 0o777) !== 0o600) throw new Error(`环境文件权限必须为 0600：${file}`);
  const values = {};
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = raw.trim().match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    const value = match[2].trim();
    values[match[1]] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  }
  return values;
}

function validateEnvironment(values) {
  if (!values.ADMIN_PASSWORD?.trim()) throw new Error("环境文件缺少 ADMIN_PASSWORD");
  try {
    const site = new URL(values.NEXT_PUBLIC_SITE_URL || "");
    if (!["http:", "https:"].includes(site.protocol)) throw new Error();
  } catch { throw new Error("环境文件缺少有效的 NEXT_PUBLIC_SITE_URL"); }
  if (values.DEPLOY_DIRECT_HTTP !== "true" && (values.TRUST_PROXY !== "true" || values.SESSION_COOKIE_SECURE !== "true")) {
    throw new Error("反向代理部署需要 TRUST_PROXY=true 和 SESSION_COOKIE_SECURE=true；直连 HTTP 时设置 DEPLOY_DIRECT_HTTP=true");
  }
}

function atomicWrite(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, value, { mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

async function waitForOrphan(env) {
  if (env.DEPLOY_REQUIRE_ORPHAN !== "1") return;
  const launcher = Number.parseInt(env.DEPLOY_LAUNCHER_PID || "", 10);
  if (env.DEPLOY_ORPHAN_WORKER !== "1" || !Number.isInteger(launcher) || launcher < 2) {
    throw new Error("部署任务未经过独立启动器，已取消 PM2 重启");
  }
  for (let attempt = 0; attempt < 100; attempt++) {
    if (process.ppid !== launcher) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("部署任务未能脱离网站进程树，已取消 PM2 重启");
}

async function reservePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function verifyHttp(url, { attempts, interval, commit, token }) {
  let detail = "尚未监听";
  for (let i = 0; i < attempts; i++) {
    try {
      const health = await fetch(url, {
        signal: AbortSignal.timeout(2_000), cache: "no-store",
        headers: { "x-deploy-probe-token": token },
      });
      const body = await health.json();
      if (!health.ok || body.status !== "ok" || (commit && body.commit !== commit)) throw new Error(`health ${health.status}`);
      const origin = new URL(url).origin;
      const home = await fetch(`${origin}/`, { signal: AbortSignal.timeout(2_000), cache: "no-store" });
      const html = await home.text();
      if (!home.ok || !(home.headers.get("content-security-policy") || "").includes("nonce-")) throw new Error("首页/CSP 校验失败");
      const chunk = html.match(/\/_next\/static\/chunks\/[^"']+\.js/)?.[0];
      if (!chunk) throw new Error("首页缺少 JS chunk");
      const asset = await fetch(`${origin}${chunk}`, { signal: AbortSignal.timeout(2_000) });
      if (!asset.ok || !(asset.headers.get("content-type") || "").includes("javascript")) throw new Error("JS chunk 校验失败");
      return;
    } catch (error) {
      detail = error.message;
      if (i + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  throw new Error(`健康检查失败：${detail}`);
}

/** The terminal and dashboard share this project-directory update workflow. */
export async function deployInPlace({ env = process.env, healthAttempts = 80, healthInterval = 500, npmCommand = "npm" } = {}) {
  // Explicit launcher settings take precedence over the file. No release directories
  // or symlinks are used; stale release settings are intentionally ignored.
  const project = fs.realpathSync(path.resolve(env.DEPLOY_PROJECT_DIR || process.cwd()));
  const environmentFile = path.resolve(env.BLOG_ENV_FILE || path.join(project, ".env.local"));
  let fileEnvironment;
  try { fileEnvironment = readEnvironment(environmentFile); }
  catch (error) {
    const data = path.join(path.resolve(env.BLOG_ROOT || project), "data");
    // A bootstrap failure must not leave a queued dashboard task forever, or
    // overwrite the status of a worker that already holds the shared lock.
    if (!fs.existsSync(path.join(data, ".deploy.lock"))) {
      fs.mkdirSync(data, { recursive: true, mode: 0o700 });
      const status = path.resolve(env.DEPLOY_STATUS_FILE || path.join(data, "deploy-status.json"));
      fs.mkdirSync(path.dirname(status), { recursive: true, mode: 0o700 });
      atomicWrite(status, `${JSON.stringify({ status: "failed", updatedAt: new Date().toISOString(), error: error.message })}\n`);
    }
    throw error;
  }
  const commandEnv = deploymentCommandEnv({ ...fileEnvironment, ...env });
  for (const key of Object.keys(commandEnv)) {
    if (key.startsWith("__NEXT_PRIVATE_") || /^(?:NEXT_)?TURBOPACK/.test(key)
      || /^(?:https?|all)_proxy$/i.test(key) || /^npm_config_(?:https?_)?proxy$/.test(key)) delete commandEnv[key];
  }
  commandEnv.GIT_TERMINAL_PROMPT = "0";
  const stateRoot = path.resolve(commandEnv.BLOG_ROOT || project);
  const database = path.resolve(commandEnv.BLOG_DB_PATH || path.join(stateRoot, "data", "blog.db"));
  const data = path.join(stateRoot, "data");
  const statusFile = path.resolve(commandEnv.DEPLOY_STATUS_FILE || path.join(data, "deploy-status.json"));
  const marker = path.join(data, "deploy-commit");
  const lock = path.join(data, ".deploy.lock");
  const processName = commandEnv.DEPLOY_PM2_NAME?.trim();
  const token = crypto.randomBytes(32).toString("hex");
  const health = { attempts: healthAttempts, interval: healthInterval, token };
  const healthUrl = commandEnv.DEPLOY_HEALTH_URL || "http://127.0.0.1:3030/api/health/deploy";
  const backup = path.join(data, `.deploy-backup-${process.pid}-${crypto.randomBytes(4).toString("hex")}`);
  const guard = path.join(data, `.deploy-write-hold-${process.pid}`);
  const moved = [];
  let lockFd, stopped = false, started = false, activated = false, recovered = false;
  let snapshot, previousCommit, originalMarker;
  const writeStatus = (status, extra = {}) => {
    fs.mkdirSync(path.dirname(statusFile), { recursive: true, mode: 0o700 });
    atomicWrite(statusFile, `${JSON.stringify({ status, updatedAt: new Date().toISOString(), ...extra })}\n`);
    console.log(`[deploy] ${status}${extra.error ? `: ${extra.error}` : ""}`);
  };
  let pm2;
  const runPm2 = (args, environment = commandEnv) => run(pm2.command, [...pm2.args, ...args], project, deploymentCommandEnv({ ...environment, PM2_HOME: pm2.env.PM2_HOME, DEPLOY_PM2_BIN: pm2.bin }), 30_000);
  const readProcess = async () => {
    const output = await runPm2(["jlist"]);
    const list = JSON.parse(output.slice(output.indexOf("["), output.lastIndexOf("]") + 1));
    if (!Array.isArray(list)) throw new Error("PM2 进程列表无效");
    return list.find((entry) => entry.name === processName);
  };
  try {
    await waitForOrphan(commandEnv);
    fs.mkdirSync(data, { recursive: true, mode: 0o700 });
    try { lockFd = fs.openSync(lock, "wx", 0o600); }
    catch (error) {
      if (error.code === "EEXIST") throw new Error("已有一次部署正在执行");
      throw error;
    }
    validateEnvironment(fileEnvironment);
    if (!processName || commandEnv.DEPLOY_RESTART_MODE === "direct") throw new Error("项目目录更新需要配置现有 DEPLOY_PM2_NAME；不会自动替换端口进程");
    if (!fs.existsSync(database)) throw new Error(`数据库不存在：${database}`);
    if (fs.realpathSync((await run("git", ["rev-parse", "--show-toplevel"], project, commandEnv)).trim()) !== project) throw new Error("部署目录不是 Git 仓库根目录");
    if ((await run("git", ["branch", "--show-current"], project, commandEnv)).trim() !== "main") throw new Error("服务器当前分支不是 main");
    if ((await run("git", ["status", "--porcelain=v1", "--untracked-files=no"], project, commandEnv)).trim()) throw new Error("服务器存在未提交的源码改动");
    pm2 = resolvePm2Command({ env: commandEnv, cwd: project });
    const original = await readProcess();
    if (!original || original.pm2_env?.status !== "online" || !original.pid) throw new Error(`PM2 中未找到正在运行的进程 ${processName}`);
    const cwd = original.pm2_env?.pm_cwd;
    if (!cwd || ![project, path.join(project, ".next", "standalone")].includes(fs.realpathSync(cwd))) throw new Error("PM2 进程不属于当前项目目录；请继续使用该进程原有部署方式");
    if (original.pm2_env?.watch) throw new Error("请先关闭当前 PM2 进程的 watch，避免构建期间自动重启");
    fs.accessSync(path.join(project, ".git"), fs.constants.W_OK);
    fs.accessSync(project, fs.constants.W_OK);
    fs.accessSync(path.dirname(database), fs.constants.W_OK);
    for (const artifact of [".next", "node_modules"]) {
      if (!fs.statSync(path.join(project, artifact)).isDirectory()) throw new Error(`缺少现有构建目录 ${artifact}`);
    }
    previousCommit = (await run("git", ["rev-parse", "HEAD"], project, commandEnv)).trim();
    originalMarker = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : null;
    await run("git", ["fetch", "origin", "main"], project, commandEnv, 120_000);
    // FETCH_HEAD avoids reliance on a custom origin fetch refspec.
    await run("git", ["merge", "--ff-only", "FETCH_HEAD"], project, commandEnv, 60_000);
    const commit = (await run("git", ["rev-parse", "HEAD"], project, commandEnv)).trim();
    console.log(`[deploy] main ${commit.slice(0, 7)}; restarting existing PM2 process ${processName}`);
    fs.mkdirSync(backup, { mode: 0o700 });
    writeStatus("building");
    stopped = true;
    await runPm2(["stop", processName]);
    // Snapshot the stopped app before changing dependencies or allowing migrations.
    await run(npmCommand, ["run", "backup"], project, { ...commandEnv, BLOG_ROOT: stateRoot, BLOG_DB_PATH: database, BLOG_BACKUP_DIR: path.join(backup, "database"), BLOG_BUILD_READONLY: "false" }, 120_000);
    const snapshots = fs.readdirSync(path.join(backup, "database")).filter((name) => /^blog-.*\.db$/.test(name));
    if (snapshots.length !== 1) throw new Error("部署前数据库快照未生成");
    snapshot = path.join(backup, "database", snapshots[0]);
    for (const artifact of [".next", "node_modules"]) {
      fs.renameSync(path.join(project, artifact), path.join(backup, artifact));
      moved.push(artifact);
    }
    const buildEnv = { ...commandEnv, BLOG_ROOT: stateRoot, BLOG_DB_PATH: database, BLOG_ENV_FILE: environmentFile, BLOG_BUILD_READONLY: "true", DEPLOY_BUILD_COMMIT: commit };
    await run(npmCommand, ["ci", "--include=dev", "--no-audit", "--no-fund"], project, buildEnv, 300_000);
    await run(npmCommand, ["run", "build"], project, buildEnv, 300_000);
    // Use the normal startup wrapper for asset preparation and a read-only smoke.
    const port = await reservePort();
    const candidate = spawn(process.execPath, [path.join(project, "scripts", "start-standalone.mjs")], {
      cwd: project, env: { ...buildEnv, PORT: String(port), HOSTNAME: "127.0.0.1" }, stdio: "ignore",
    });
    let candidateError;
    candidate.on("error", (error) => { candidateError = error; });
    try {
      await verifyHttp(`http://127.0.0.1:${port}/api/health/deploy`, health);
      if (candidateError) throw candidateError;
    } finally {
      if (candidate.exitCode === null && candidate.signalCode === null && candidate.pid) {
        const exited = once(candidate, "exit");
        candidate.kill("SIGTERM");
        let timer;
        await Promise.race([exited, new Promise((resolve) => { timer = setTimeout(resolve, 5_000); })]);
        clearTimeout(timer);
        if (candidate.exitCode === null && candidate.signalCode === null) { candidate.kill("SIGKILL"); await exited; }
      }
    }
    atomicWrite(guard, `${process.pid}\n`);
    const runtimeEnv = { ...buildEnv, BLOG_BUILD_READONLY: "false", BLOG_DEPLOY_WRITE_HOLD: "true", BLOG_DEPLOY_WRITE_GUARD_FILE: guard, DEPLOY_PROBE_TOKEN: token };
    writeStatus("switching");
    started = true;
    await runPm2(["restart", processName, "--update-env"], runtimeEnv);
    const current = await readProcess();
    if (current?.pm2_env?.status !== "online" || !current.pid || current.pid === original.pid
      || current.pm2_env.pm_cwd !== original.pm2_env.pm_cwd || current.pm2_env.pm_exec_path !== original.pm2_env.pm_exec_path) throw new Error("PM2 未按原启动配置重启项目");
    writeStatus("checking");
    await verifyHttp(healthUrl, health);
    atomicWrite(marker, `${commit}\n`);
    await verifyHttp(healthUrl, { ...health, commit });
    // Once writes resume, a rollback could discard user data. Keep the tail
    // non-fatal and never restore a snapshot after this point.
    fs.rmSync(guard);
    activated = true;
    try { await runPm2(["save"], runtimeEnv); } catch (error) { console.warn(`[deploy] PM2 save: ${error.message}`); }
    writeStatus("success", { commit: commit.slice(0, 7) });
    recovered = true;
    return { commit };
  } catch (error) {
    let detail = error.message;
    if (stopped && !activated) {
      try {
        writeStatus("rolling_back", { error: detail });
        await runPm2(["stop", processName]);
        for (const artifact of moved) {
          fs.rmSync(path.join(project, artifact), { recursive: true, force: true });
          fs.renameSync(path.join(backup, artifact), path.join(project, artifact));
        }
        if (started && snapshot) {
          fs.rmSync(`${database}-wal`, { force: true });
          fs.rmSync(`${database}-shm`, { force: true });
          const temporary = `${database}.${process.pid}.restore`;
          fs.copyFileSync(snapshot, temporary);
          fs.chmodSync(temporary, 0o600);
          fs.renameSync(temporary, database);
        }
        // Source HEAD may have advanced; retain an accurate deployed-version
        // record when restoring the previous build, even on the first update.
        atomicWrite(marker, originalMarker || `${previousCommit}\n`);
        if (!fs.existsSync(guard)) atomicWrite(guard, `${process.pid}\n`);
        await runPm2(["restart", processName, "--update-env"], {
          ...commandEnv, BLOG_ROOT: stateRoot, BLOG_DB_PATH: database, BLOG_ENV_FILE: environmentFile,
          BLOG_BUILD_READONLY: "false", BLOG_DEPLOY_WRITE_HOLD: "true", BLOG_DEPLOY_WRITE_GUARD_FILE: guard, DEPLOY_BUILD_COMMIT: originalMarker?.trim() || previousCommit,
        });
        await verifyHttp(healthUrl, health);
        recovered = true;
        detail += "；已恢复旧构建并重启原 PM2 进程，源码 main 保留已拉取的提交，可重新部署";
      } catch (rollbackError) {
        detail += `；恢复失败：${rollbackError.message}；备份保留在 ${backup}`;
      }
    }
    if (lockFd !== undefined) writeStatus(activated ? "success" : "failed", { error: detail });
    throw new Error(detail);
  } finally {
    if (lockFd !== undefined) { fs.closeSync(lockFd); fs.rmSync(lock, { force: true }); }
    if (recovered) {
      fs.rmSync(guard, { force: true });
      fs.rmSync(backup, { recursive: true, force: true });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  deployInPlace().catch((error) => { console.error(`[deploy] ${error.message}`); process.exitCode = 1; });
}
