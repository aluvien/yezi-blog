import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";
import { executeAdminBackup, getAdminBackupDownload, getAdminBackupStatus, startAdminBackup } from "@/lib/admin-backup";
import { cloudBackupRoot, requireCloudSettings, writePrivateJson, type StoredCloudSettings } from "@/lib/cloud-backup-config";
import { decryptCloudArchive, encryptCloudArchive, extractAndVerifyCloudArchive, fileHash } from "@/lib/cloud-backup-archive";
import { CLOUD_FILE_PATTERN, WebDavClient } from "@/lib/webdav";
import { cloudBackupSiteLabel } from "@/lib/cloud-backup-name";
import type { CloudBackupTask, CloudBackupPhase } from "@/lib/cloud-backup-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const runtime = globalThis as typeof globalThis & { yeziCloudBootId?: string };
runtime.yeziCloudBootId ??= crypto.randomUUID();
type CloudLock = { id: string; pid: number; bootId: string };
export function cloudStage(id: string): string {
  if (!UUID.test(id)) throw new Error("云备份任务编号无效。");
  return path.join(cloudBackupRoot(), `stage-${id}`);
}
export function writeCloudTask(task: CloudBackupTask): void { writePrivateJson(path.join(cloudBackupRoot(), "status.json"), task); }
export function getCloudTask(): CloudBackupTask | null {
  const root = cloudBackupRoot();
  const statusPath = path.join(root, "status.json");
  if (!fs.existsSync(statusPath)) return null;
  const task = JSON.parse(fs.readFileSync(statusPath, "utf8")) as CloudBackupTask;
  if (task.status === "running" && !isCloudBusy()) {
    task.status = "failed"; task.updatedAt = new Date().toISOString(); task.error = "网站进程重启，云备份任务已中断，请重试。";
    writeCloudTask(task);
  }
  if (task.status === "completed" && task.kind === "prepare" && task.phase === "ready") {
    const stage = cloudStage(task.id);
    const file = path.join(stage, "prepared.json");
    const prepared = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) as { expiresAt: number } : null;
    if (!prepared || prepared.expiresAt < Date.now()) {
      fs.rmSync(stage, { recursive: true, force: true });
      task.status = "failed"; task.error = "云备份校验已过期，请重新下载校验。"; task.updatedAt = new Date().toISOString(); writeCloudTask(task);
    }
  }
  return task;
}
export function isCloudBusy(): boolean {
  const lockFile = path.join(cloudBackupRoot(), ".lock");
  if (!fs.existsSync(lockFile)) return false;
  let lock: CloudLock;
  try { lock = JSON.parse(fs.readFileSync(lockFile, "utf8")); }
  catch { if (Date.now() - fs.statSync(lockFile).mtimeMs < 60_000) return true; fs.rmSync(lockFile, { force: true }); return false; }
  if (lock.pid === process.pid && lock.bootId === runtime.yeziCloudBootId) return true;
  if (lock.pid !== process.pid && Number.isInteger(lock.pid) && lock.pid > 0) {
    try { process.kill(lock.pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") return true; }
  }
  fs.rmSync(lockFile, { force: true });
  return false;
}
export function acquireCloudLock(id: string): void {
  if (!UUID.test(id)) throw new Error("任务编号无效。");
  if (isCloudBusy()) throw new Error("另一个云备份任务正在执行，请稍后重试。");
  const fd = fs.openSync(path.join(cloudBackupRoot(), ".lock"), "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify({ id, pid: process.pid, bootId: runtime.yeziCloudBootId })); } finally { fs.closeSync(fd); }
}
export function releaseCloudLock(id: string): void {
  const file = path.join(cloudBackupRoot(), ".lock");
  if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).id === id) fs.rmSync(file, { force: true });
}
export function startCloudTask(kind: CloudBackupTask["kind"], name?: string): { task: CloudBackupTask; started: boolean } {
  requireCloudSettings();
  if (kind === "prepare" && (!name || !CLOUD_FILE_PATTERN.test(name))) throw new Error("请选择有效的云备份文件。");
  const previous = getCloudTask();
  if (isCloudBusy()) {
    if (previous?.status === "running" && previous.kind === kind && previous.name === name) return { task: previous, started: false };
    throw new Error("另一个云备份任务正在执行，请稍后重试。");
  }
  if (fs.existsSync(path.join(cloudBackupRoot(), "restore-journal.json"))) throw new Error("上次恢复尚未完成回滚，请先重启网站完成恢复保护。");
  // Preparation contains plaintext secrets. Keep it at most thirty minutes and remove prior idle workspaces.
  for (const entry of fs.readdirSync(cloudBackupRoot())) {
    if (/^stage-[0-9a-f-]{36}$/.test(entry)) fs.rmSync(path.join(cloudBackupRoot(), entry), { recursive: true, force: true });
  }
  const id = crypto.randomUUID();
  acquireCloudLock(id);
  const now = new Date().toISOString();
  const task: CloudBackupTask = { id, kind, status: "running", phase: kind === "backup" ? "snapshot" : kind === "prepare" ? "download" : "verify", createdAt: now, updatedAt: now, ...(name ? { name } : {}) };
  try { writeCloudTask(task); } catch (error) { releaseCloudLock(id); throw error; }
  return { task, started: true };
}
export function updateCloudPhase(task: CloudBackupTask, phase: CloudBackupPhase): void {
  task.phase = phase; task.updatedAt = new Date().toISOString(); writeCloudTask(task);
}
export function publicCloudError(error: unknown): string {
  // Network libraries and archive utilities may include credentials, host paths or remote response bodies.
  const message = error instanceof Error ? error.message : "";
  if (/^(WebDAV |无法连接 WebDAV|WebDAV 返回|WebDAV 未返回|备份路径|远程备份|恢复密钥|该文件不是|备份包含|备份文件|备份超过|请选择|另一个|请先|云备份|网站进程|上次恢复|恢复失败|备份数据库|当前数据库|备份版本)/.test(message) && !/[\r\n]/.test(message)) return message.slice(0, 250);
  return "云备份操作未完成，请检查磁盘空间、文件权限、网络和 WebDAV 配置后重试。";
}
export async function downloadCloudBackup(name: string): Promise<{ body: ReadableStream<Uint8Array>; size: number }> {
  if (!CLOUD_FILE_PATTERN.test(name)) throw new Error("请选择有效的云备份文件。");
  const client = new WebDavClient(requireCloudSettings());
  const file = (await client.list()).find(item => item.name === name);
  if (!file) throw new Error("远程备份不存在，请刷新列表。");
  return { body: await client.streamDownload(name, file.sizeBytes), size: file.sizeBytes };
}
export async function deleteCloudBackup(name: string): Promise<void> {
  if (!CLOUD_FILE_PATTERN.test(name)) throw new Error("请选择有效的云备份文件。");
  const settings = requireCloudSettings();
  const id = crypto.randomUUID();
  acquireCloudLock(id);
  try {
    if (fs.existsSync(path.join(cloudBackupRoot(), "restore-journal.json"))) throw new Error("上次恢复尚未完成回滚，请先重启网站完成恢复保护。");
    const client = new WebDavClient(settings);
    if (!(await client.list()).some(file => file.name === name)) throw new Error("远程备份不存在，请刷新列表。");
    await client.remove(name);
    if ((await client.list()).some(file => file.name === name)) throw new Error("远程备份删除未完成，请刷新列表后重试。");
    const task = getCloudTask();
    if (task?.kind === "prepare" && task.name === name && task.phase === "ready") {
      fs.rmSync(cloudStage(task.id), { recursive: true, force: true });
      fs.rmSync(path.join(cloudBackupRoot(), "status.json"), { force: true });
    }
  } finally { releaseCloudLock(id); }
}
export async function executeCloudTask(id: string): Promise<void> {
  const task = getCloudTask();
  if (!task || task.id !== id || task.status !== "running") return;
  const stage = cloudStage(id);
  let preserve = false;
  try {
    fs.mkdirSync(stage, { mode: 0o700 });
    const settings = requireCloudSettings();
    const client = new WebDavClient(settings);
    if (task.kind === "test") {
      await client.test(stage);
      updateCloudPhase(task, "complete");
    } else if (task.kind === "backup") {
      await client.ensureDirectory();
      const snapshot = startAdminBackup();
      if (!snapshot.started) throw new Error("另一个本地备份任务正在执行，请稍后重试。");
      await executeAdminBackup(snapshot.status.id);
      const archive = getAdminBackupDownload(snapshot.status.id);
      if (!archive) throw new Error(getAdminBackupStatus()?.error ?? "备份文件生成失败。");
      updateCloudPhase(task, "encrypt");
      const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
      const siteLabel = cloudBackupSiteLabel();
      const name = `yezi-complete-${stamp}-${siteLabel}-${id}.tar.gz.enc`;
      const encrypted = path.join(stage, name);
      await encryptCloudArchive(archive.path, encrypted, settings.key);
      task.name = name;
      updateCloudPhase(task, "upload");
      let uploaded = false;
      try {
        await client.upload(name, encrypted, transfer => {
          task.transfer = transfer; task.updatedAt = new Date().toISOString(); writeCloudTask(task);
        }); uploaded = true;
        updateCloudPhase(task, "verify");
        const roundTrip = path.join(stage, "uploaded.enc");
        await client.download(name, roundTrip);
        if (await fileHash(encrypted) !== await fileHash(roundTrip)) throw new Error("远程备份回读校验失败。");
        const files = await client.list();
        if (!files.some(file => file.name === name)) throw new Error("远程备份未出现在目录中。");

      } catch (error) { if (uploaded || !(error instanceof Error && error.message.includes("（412）"))) { try { await client.remove(name); } catch { /* Keep the original failure; no old backups are reported as replaced. */ } } throw error; }
      // A deletion failure must never remove an already verified new backup.
      try { for (const old of (await client.list()).filter(file => file.name !== name && file.site === siteLabel).slice(settings.keep - 1)) await client.remove(old.name); }
      catch { task.warning = "新备份已校验完成，但旧备份清理未完成，请检查 WebDAV 删除权限。"; }
      updateCloudPhase(task, "complete");
    } else {
      const files = await client.list();
      if (!files.some(file => file.name === task.name)) throw new Error("远程备份不存在，请刷新列表。");
      const encrypted = path.join(stage, "remote.enc");
      await client.download(task.name!, encrypted);
      updateCloudPhase(task, "decrypt");
      const archive = path.join(stage, "complete.tar.gz");
      await decryptCloudArchive(encrypted, archive, settings.key);
      updateCloudPhase(task, "validate");
      const extracted = path.join(stage, "content");
      const manifest = await extractAndVerifyCloudArchive(archive, extracted);
      const database = new Database(path.join(extracted, "data", "blog.db"), { readonly: true, fileMustExist: true });
      try {
        const count = (table: string) => Number((database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number }).count);
        task.preview = { createdAt: manifest.createdAt, files: manifest.files.filter(file => file.path.startsWith("data/")).length, posts: count("posts"), moments: count("moments"), attachments: count("attachments"), schemaVersion: manifest.schemaVersion, configurationFiles: manifest.files.filter(file => file.path.startsWith("config/")).length };
      } finally { database.close(); for (const suffix of ["-wal", "-shm"]) fs.rmSync(`${path.join(extracted, "data", "blog.db")}${suffix}`, { force: true }); }
      writePrivateJson(path.join(stage, "prepared.json"), { settingsVersion: settings.version, archiveHash: await fileHash(archive), expiresAt: Date.now() + 30 * 60_000 });
      updateCloudPhase(task, "ready");
      preserve = true;
      const expiry = setTimeout(() => {
        if (!isCloudBusy() && !fs.existsSync(path.join(cloudBackupRoot(), "restore-journal.json"))) {
          fs.rmSync(stage, { recursive: true, force: true });
          getCloudTask();
        }
      }, 30 * 60_000);
      expiry.unref?.();
    }
    task.status = "completed"; task.updatedAt = new Date().toISOString(); writeCloudTask(task);
  } catch (error) {
    task.status = "failed"; task.error = publicCloudError(error); task.updatedAt = new Date().toISOString(); writeCloudTask(task);
  } finally {
    if (!preserve) fs.rmSync(stage, { recursive: true, force: true });
    releaseCloudLock(id);
  }
}
export function preparedCloudDownload(id: string): { path: string; size: number } {
  const stage = cloudStage(id);
  const prepared = JSON.parse(fs.readFileSync(path.join(stage, "prepared.json"), "utf8")) as { settingsVersion: string; expiresAt: number };
  if (prepared.settingsVersion !== requireCloudSettings().version || prepared.expiresAt < Date.now()) throw new Error("云备份校验已过期，请重新下载校验。");
  const file = path.join(stage, "complete.tar.gz");
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error("云备份下载不存在。");
  return { path: file, size: stat.size };
}
export async function runDailyCloudBackup(): Promise<void> {
  const settings: StoredCloudSettings | null = (await import("@/lib/cloud-backup-config")).readCloudSettings();
  if (!settings?.dailyEnabled || isCloudBusy()) return;
  const started = startCloudTask("backup");
  if (started.started) await executeCloudTask(started.task.id);
}
