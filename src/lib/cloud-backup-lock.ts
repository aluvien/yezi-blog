// Filesystem-only leases: detached restore workers must not open the live DB.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getProjectRoot } from "@/lib/uploads";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const runtime = globalThis as typeof globalThis & { yeziCloudBootId?: string };
runtime.yeziCloudBootId ??= crypto.randomUUID();
type CloudLock = { id: string; pid: number; bootId: string };

export function cloudBackupRoot(): string {
  const directory = path.join(getProjectRoot(), "data", "backups", "cloud");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.lstatSync(directory).isDirectory()) throw new Error("云备份目录不可用。");
  fs.chmodSync(directory, 0o700);
  return directory;
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
