// Detached from the web process before PM2 is stopped. Never imported by Next.
import { register } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { acquireProcessLock, releaseProcessLock } from "./process-lock.mjs";
import { resolvePm2Command } from "./pm2-command.mjs";
register("./backup-resolve.mjs", import.meta.url);
const run = promisify(execFile);
const management = await import("../src/lib/backup-management.ts");
const { runDbBackup } = await import("../src/lib/backup.ts");
const { runCompleteDataBackup } = await import("../src/lib/data-backup.ts");
const { prepareRestore, replaceOfflineData } = await import("../src/lib/backup-restore.ts");
const { withDataFilesLock } = await import("../src/lib/data-files-lock.ts");
const { withAdminBackupTaskLock } = await import("../src/lib/admin-backup.ts");
const { acquireCloudLock, releaseCloudLock } = await import("../src/lib/cloud-backup-lock.ts");
const directory = management.backupJobDirectory();
let job = management.latestBackupJob();
if (!job || job.id !== process.env.BACKUP_JOB_ID) throw new Error("备份任务标识不匹配");
function status(value, message) {
  job = { ...job, workerPid: process.pid, status: value, message, updatedAt: new Date().toISOString() };
  management.writeBackupJob(job);
}
const project = path.resolve(process.env.DEPLOY_PROJECT_DIR || process.cwd());
const releases = path.resolve(process.env.DEPLOY_RELEASES_DIR || path.join(path.dirname(project), "yezi-blog-releases"));
const deploymentLock = path.join(path.dirname(directory), ".deploy.lock");
let deploymentLease;
let prepared;
let replacement;
let stopped = false;
let supervisor;
let retainLock = false;
const writeGuard = path.join(directory, "restore-write-hold");
const pm2 = async (...args) => {
  const command = resolvePm2Command({ env: process.env, cwd: project });
  return run(command.command, [...command.args, ...args], { timeout: 60_000, maxBuffer: 4 * 1024 * 1024, env: command.env });
};
async function health() {
  const url = process.env.DEPLOY_HEALTH_URL || "http://127.0.0.1:3030/api/health/deploy";
  for (let i = 0; i < 30; i++) {
    try { const result = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (result.ok && (await result.json()).status === "ok") return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error("恢复后网站健康检查未通过");
}
async function perform() {
try {
  if (process.env.DEPLOY_ORPHAN_WORKER !== "1") throw new Error("恢复任务必须独立运行");
  const launcher = Number(process.env.DEPLOY_LAUNCHER_PID);
  for (let i = 0; i < 100 && process.ppid === launcher; i++) await new Promise(resolve => setTimeout(resolve, 25));
  if (process.ppid === launcher) throw new Error("任务未能脱离网站进程");
  fs.mkdirSync(releases, { recursive: true });
  deploymentLease = acquireProcessLock(deploymentLock, "已有一次部署正在执行");
  if (job.action === "create") {
    status("running", "正在创建并校验备份");
    const result = job.kind === "complete" ? await runCompleteDataBackup() : await runDbBackup();
    job.resultId = `${job.kind}:${path.basename(result.path)}`;
    status("succeeded", "备份完成");
  } else {
    status("validating", "正在校验备份，尚未修改网站数据");
    const file = management.backupFile(job.backupId);
    prepared = await prepareRestore(file.path, file.kind);
    const processes = JSON.parse((await pm2("jlist")).stdout);
    supervisor = process.env.DEPLOY_PM2_NAME?.trim() || "yezi-blog";
    const matches = processes.filter(item => item.name === supervisor);
    if (matches.length !== 1 || matches[0].pm2_env?.status !== "online") throw new Error("恢复要求唯一且正在运行的 PM2 网站进程");
    const cwd = fs.realpathSync(matches[0].pm2_env.pm_cwd);
    const roots = [project, releases, process.env.DEPLOY_CURRENT_LINK].filter(Boolean).map(value => path.resolve(value));
    if (!roots.some(root => cwd === root || cwd.startsWith(root + path.sep))) throw new Error("PM2 进程与当前网站目录不匹配");
    // Serialize with automatic online backups as well; never steal their locks.
    for (const root of new Set(Object.values(management.backupDirectories()))) {
      if ([".backup.lock", ".data-backup.lock"].some(name => fs.existsSync(path.join(root, name)))) throw new Error("自动备份正在运行，请稍后恢复");
    }
    status("restoring", "网站短暂维护中，正在保留当前数据");
    fs.writeFileSync(writeGuard, job.id, { mode: 0o600 });
    process.env.BLOG_DEPLOY_WRITE_HOLD = "true";
    process.env.BLOG_DEPLOY_WRITE_GUARD_FILE = writeGuard;
    stopped = true; await pm2("stop", supervisor);
    const offline = JSON.parse((await pm2("jlist")).stdout).find(item => item.name === supervisor);
    if (!offline || offline.pm2_env?.status !== "stopped" || offline.pid) throw new Error("网站进程尚未停止，取消恢复");
    const safety = job.kind === "complete" ? await runCompleteDataBackup() : await runDbBackup();
    job.resultId = `${job.kind}:${path.basename(safety.path)}`;
    replacement = replaceOfflineData(prepared, job.id);
    status("restarting", "正在启动网站并检查恢复结果；完成后需重新登录");
    await pm2("restart", supervisor, "--update-env"); stopped = false;
    await health();
    replacement.commit();
    status("succeeded", "恢复完成；原数据已备份，请重新登录");
  }
} catch (error) {
  let message = error instanceof Error ? error.message : "备份任务失败";
  if (replacement || stopped) {
    try {
      if (replacement && !stopped) { await pm2("stop", supervisor); stopped = true; }
      replacement?.rollback();
      if (stopped) { await pm2("restart", supervisor, "--update-env"); stopped = false; await health(); }
      message += "；已保留或回退到恢复前的数据";
    } catch {
      retainLock = true;
      message += "；自动回退未完成，网站保持维护状态，请在服务器检查 backup-jobs 中的恢复记录";
    }
  }
  status("failed", message);
  process.exitCode = 1;
} finally {
  prepared?.cleanup();
  if (!retainLock) {
    fs.rmSync(writeGuard, { force: true });
    if (deploymentLease) releaseProcessLock(deploymentLease);
    fs.rmSync(path.join(directory, ".lock"), { force: true });
  }
}
}

let ownsCloudLock = false;
try {
  acquireCloudLock(job.id); ownsCloudLock = true;
  await withAdminBackupTaskLock(() => withDataFilesLock(perform));
} catch (error) {
  status("failed", error instanceof Error ? error.message : "备份任务无法开始");
  fs.rmSync(path.join(directory, ".lock"), { force: true });
  process.exitCode = 1;
} finally {
  if (ownsCloudLock && !retainLock) releaseCloudLock(job.id);
}
