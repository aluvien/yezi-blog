import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { getProjectRoot } from "./uploads";

export type BackupKind = "database" | "complete";
export type BackupJob = { id: string; action: "create" | "restore"; kind: BackupKind; backupId?: string; status: string; updatedAt: string; message?: string; resultId?: string; workerPid?: number };
export function backupDirectories() {
  return { database: path.resolve(process.env.BLOG_BACKUP_DIR?.trim() || path.join(getProjectRoot(), "data/backups")), complete: path.join(getProjectRoot(), "data/backups") };
}
export function backupJobDirectory() { return path.join(getProjectRoot(), "data", "backup-jobs"); }
export function backupFile(id: string): { path: string; kind: BackupKind; name: string } {
  const match = /^(database|complete):(blog-[A-Za-z0-9-]+\.db|data-[A-Za-z0-9-]+\.tar\.gz\.enc)$/.exec(id);
  if (!match || (match[1] === "database") !== match[2].endsWith(".db")) throw new Error("备份标识无效");
  const kind = match[1] as BackupKind;
  const root = backupDirectories()[kind];
  const file = path.join(root, match[2]);
  if (!fs.lstatSync(file).isFile() || path.dirname(fs.realpathSync(file)) !== fs.realpathSync(root)) throw new Error("备份文件无效");
  return { path: file, kind, name: match[2] };
}
export function listBackups() {
  return (Object.entries(backupDirectories()) as Array<[BackupKind, string]>).flatMap(([kind, directory]) => {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory).flatMap(name => {
      try { const file = backupFile(`${kind}:${name}`); const stat = fs.statSync(file.path);
        return [{ id: `${kind}:${name}`, name, kind, size: stat.size, createdAt: stat.mtime.toISOString() }];
      } catch { return []; }
    });
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function latestBackupJob(): BackupJob | null {
  try {
    const job = JSON.parse(fs.readFileSync(path.join(backupJobDirectory(), "latest.json"), "utf8")) as BackupJob;
    if (!["succeeded", "failed"].includes(job.status)) {
      if (job.workerPid) {
        try { process.kill(job.workerPid, 0); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return { ...job, status: "failed", message: "备份任务意外中断。为保护数据，锁已保留；请在服务器检查 backup-jobs 任务与恢复记录。" }; }
      } else if (Date.now() - Date.parse(job.updatedAt) > 60_000) {
        return { ...job, status: "failed", message: "备份任务未能启动，请检查服务器任务日志。" };
      }
    }
    return job;
  } catch { return null; }
}
export function writeBackupJob(job: BackupJob) {
  const directory = backupJobDirectory(); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `${job.id}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(job), { mode: 0o600 });
  fs.renameSync(temporary, path.join(directory, "latest.json"));
}
export async function startBackupJob(action: "create" | "restore", kind: BackupKind, backupId?: string): Promise<BackupJob> {
  if (action === "restore") { if (!backupId || backupFile(backupId).kind !== kind) throw new Error("备份不存在"); }
  const project = path.resolve(process.env.DEPLOY_PROJECT_DIR?.trim() || getProjectRoot());
  const runner = path.join(project, "scripts/backup-worker.mjs");
  const launcher = path.join(project, "scripts/launch-detached-deploy.mjs");
  if (!fs.existsSync(runner) || !fs.existsSync(launcher)) throw new Error("服务器尚未安装备份任务脚本");
  if (action === "restore" && process.env.DEPLOY_RESTART_MODE === "direct") throw new Error("恢复需要 PM2 托管网站；当前部署不支持自动停止和恢复");
  if (kind === "complete" && !process.env.DATA_BACKUP_KEY?.trim()) throw new Error("服务器尚未配置完整备份加密密钥");
  const directory = backupJobDirectory(); fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const lock = path.join(directory, ".lock");
  let fd: number;
  try { fd = fs.openSync(lock, "wx", 0o600); } catch { throw new Error("已有备份或恢复任务运行中，请稍后查看状态"); }
  const job: BackupJob = { id: crypto.randomUUID(), action, kind, backupId, status: "queued", updatedAt: new Date().toISOString() };
  fs.writeFileSync(fd, job.id); fs.closeSync(fd);
  writeBackupJob(job);
  try {
    await new Promise<void>((resolve, reject) => execFile(process.execPath, [launcher, runner], {
      cwd: project, timeout: 10_000,
      env: { ...process.env, DEPLOY_PROJECT_DIR: project, DEPLOY_LOG_FILE: path.join(directory, "worker.log"), BACKUP_JOB_ID: job.id },
    }, error => error ? reject(error) : resolve()));
    return job;
  } catch (error) {
    writeBackupJob({ ...job, status: "failed", message: "备份任务启动失败" }); fs.rmSync(lock, { force: true }); throw error;
  }
}
