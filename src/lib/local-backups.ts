import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getProjectRoot } from "@/lib/uploads";
import { clearDeletedAdminBackupStatus, getAdminBackupStatus, withAdminBackupMaintenanceLock } from "@/lib/admin-backup";
import { acquireCloudLock, getCloudTask, isCloudBusy, releaseCloudLock, writeCloudTask } from "@/lib/cloud-backup";
import type { LocalBackupFile, LocalBackupKind, LocalBackupList } from "@/lib/admin-backup-types";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
type Catalog = { kind: LocalBackupKind; directory: string; pattern: RegExp };
function catalogs(): Catalog[] {
  const root = path.join(getProjectRoot(), "data", "backups");
  return [
    { kind: "admin", directory: path.join(root, "admin"), pattern: new RegExp(`^${UUID}\\.tar\\.gz$`) },
    { kind: "database", directory: path.resolve(process.env.BLOG_BACKUP_DIR?.trim() || root), pattern: /^blog-(?:\d{14}|\d{17}-[0-9a-f]{8})\.db$/ },
    { kind: "data", directory: root, pattern: /^data-\d{17}-[0-9a-f]{8}\.tar\.gz\.enc$/ },
    { kind: "restore", directory: path.join(root, "cloud"), pattern: new RegExp(`^rollback-${UUID}\\.tar\\.gz$`) },
  ];
}
export class LocalBackupError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}
function catalogFor(kind: string, name: string): Catalog {
  const catalog = catalogs().find(item => item.kind === kind);
  if (!catalog || !catalog.pattern.test(name)) throw new LocalBackupError("请选择有效的本地备份文件。");
  return catalog;
}
function regularFile(file: string): fs.Stats | null {
  try { const stat = fs.lstatSync(file); return stat.isFile() && stat.nlink === 1 && stat.size > 0 ? stat : null; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function dailyLocks(): string[] {
  const sources = catalogs();
  return [path.join(sources.find(item => item.kind === "data")!.directory, ".data-backup.lock"), path.join(sources.find(item => item.kind === "database")!.directory, ".backup.lock")];
}
function restoreJournal(): string { return path.join(getProjectRoot(), "data", "backups", "cloud", "restore-journal.json"); }
export function listLocalBackups(): LocalBackupList {
  const status = getAdminBackupStatus();
  const files: LocalBackupFile[] = [];
  for (const catalog of catalogs()) {
    if (!fs.existsSync(catalog.directory)) continue;
    for (const name of fs.readdirSync(catalog.directory)) {
      if (!catalog.pattern.test(name) || (catalog.kind === "admin" && status?.status === "running" && name === `${status.id}.tar.gz`)) continue;
      const stat = regularFile(path.join(catalog.directory, name));
      if (stat) files.push({ kind: catalog.kind, name, sizeBytes: stat.size, createdAt: stat.mtime.toISOString(), encrypted: catalog.kind === "data" });
    }
  }
  files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  return { files, count: files.length, totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0), busy: status?.status === "running" || isCloudBusy() || fs.existsSync(restoreJournal()) || dailyLocks().some(file => fs.existsSync(file)) };
}
export function openLocalBackupDownload(kind: string, name: string): { fd: number; size: number; name: string; type: string } {
  const catalog = catalogFor(kind, name);
  if (!listLocalBackups().files.some(file => file.kind === kind && file.name === name)) throw new LocalBackupError("本地备份不存在或尚未完成，请刷新列表。", 404);
  const file = path.join(catalog.directory, name);
  let fd: number;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { if (["ENOENT", "ELOOP"].includes((error as NodeJS.ErrnoException).code ?? "")) throw new LocalBackupError("本地备份不存在，请刷新列表。", 404); throw error; }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0) throw new LocalBackupError("本地备份不可下载。", 404);
    return { fd, size: stat.size, name, type: kind === "admin" || kind === "restore" ? "application/gzip" : "application/octet-stream" };
  } catch (error) { fs.closeSync(fd); throw error; }
}
export function deleteLocalBackup(kind: string, name: string): void {
  const catalog = catalogFor(kind, name);
  const previousCloudTask = getCloudTask();
  const id = crypto.randomUUID();
  try { acquireCloudLock(id); }
  catch { throw new LocalBackupError("云备份或恢复任务正在执行，请稍后再删除。", 409); }
  try {
    if (fs.existsSync(restoreJournal())) throw new LocalBackupError("恢复保护尚未结束，请完成恢复后再删除。", 409);
    withAdminBackupMaintenanceLock(() => {
      const held: Array<{ path: string; fd: number }> = [];
      try {
        // Acquire the same locks as the daily producer, in its data -> database order.
        for (const lock of dailyLocks()) {
          if (!fs.existsSync(path.dirname(lock))) continue;
          try { held.push({ path: lock, fd: fs.openSync(lock, "wx", 0o600) }); }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new LocalBackupError("自动备份任务正在执行，请稍后再删除。", 409); throw error; }
        }
        const file = path.join(catalog.directory, name);
        if (!regularFile(file)) throw new LocalBackupError("本地备份不存在，请刷新列表。", 404);
        fs.unlinkSync(file);
        if (kind === "admin") clearDeletedAdminBackupStatus(name.replace(/\.tar\.gz$/, ""));
        if (kind === "restore" && previousCloudTask?.safetyBackup === name) {
          previousCloudTask.safetyBackup = undefined; writeCloudTask(previousCloudTask);
        }
      } finally { for (const lock of held.reverse()) { fs.closeSync(lock.fd); fs.rmSync(lock.path, { force: true }); } }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "本地备份任务正在执行，请稍后再删除。") throw new LocalBackupError(error.message, 409);
    throw error;
  } finally { releaseCloudLock(id); }
}
