import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "@/lib/db/core";
import { countActiveArticleReferenceArchiveJobs } from "@/lib/db/references";
import { runMigrations, LATEST_DB_SCHEMA_VERSION } from "@/lib/db/migrations";
import { ensureFtsIndexes } from "@/lib/db/fts";
import { verifyDatabaseBackup } from "@/lib/backup-verification";
import { runDbBackup } from "@/lib/backup";
import { executeAdminBackup, getAdminBackupDownload, startAdminBackup, verifyAdminBackupContents } from "@/lib/admin-backup";
import { cloudBackupRoot, requireCloudSettings, writePrivateJson } from "@/lib/cloud-backup-config";
import { acquireCloudLock, cloudStage, getCloudTask, isCloudBusy, preparedCloudDownload, publicCloudError, releaseCloudLock, updateCloudPhase, writeCloudTask } from "@/lib/cloud-backup";
import { cloudRestoreGuardPath } from "@/lib/cloud-restore-guard";
import { fileHash } from "@/lib/cloud-backup-archive";
import { getProjectRoot } from "@/lib/uploads";
import { invalidateQQMusicAccessCache } from "@/lib/qq-music-access";
import type { CloudBackupTask } from "@/lib/cloud-backup-types";

type Move = { target: string; old: string; next: string; hadOriginal: boolean };
type Journal = { id: string; dbPath: string; rollbackDb: string; committed: boolean; moves: Move[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRESERVE = new Set(["backups", "qq-music-audio", "blog.db", "blog.db-wal", "blog.db-shm"]);
function preserved(name: string): boolean { return PRESERVE.has(name) || /^deploy(?:[.-]|$)/.test(name) || name.endsWith(".tmp"); }
function databasePath(): string { return path.resolve(process.env.BLOG_DB_PATH?.trim() || path.join(getProjectRoot(), "data", "blog.db")); }
function storeJournal(journal: Journal): void { writePrivateJson(path.join(cloudBackupRoot(), "restore-journal.json"), journal); }
function externalStateFiles(): Array<{ name: string; target: string }> {
  const sourceDb = databasePath();
  return [
    { name: "qq-music-session.json", target: path.resolve(process.env.QQ_MUSIC_SESSION_PATH?.trim() || path.join(path.dirname(sourceDb), "qq-music-session.json")) },
    { name: "telegram-bot-state.json", target: path.join(path.dirname(sourceDb), "telegram-bot-state.json") },
  ];
}
async function replaceDatabase(source: string, destination: string): Promise<void> {
  const snapshot = new Database(source, { readonly: true, fileMustExist: true, timeout: 5000 });
  try {
    // SQLite online backup replaces the destination transactionally, including its WAL.
    // Keep the live connection open; never unlink a database used by the server.
    await snapshot.backup(destination, { progress: () => 0x7fffffff });
  } finally { snapshot.close(); }
}
function validateJournal(journal: Journal): void {
  if (!UUID.test(journal.id) || journal.dbPath !== databasePath() || !path.resolve(journal.rollbackDb).startsWith(`${cloudStage(journal.id)}${path.sep}`)) throw new Error("恢复保护记录无效。");
  const dataRoot = path.join(getProjectRoot(), "data");
  const external = externalStateFiles().map(file => file.target);
  for (const move of journal.moves) {
    const relative = path.relative(dataRoot, move.target);
    const local = relative && !relative.includes(path.sep) && !preserved(relative) && !relative.startsWith(".") && !path.isAbsolute(relative);
    if ((!local && !external.includes(move.target)) || move.old !== `${move.target}.yezi-${journal.id}.old` || move.next !== `${move.target}.yezi-${journal.id}.new`) throw new Error("恢复保护路径无效。");
  }
}
async function rollback(journal: Journal): Promise<void> {
  validateJournal(journal);
  verifyDatabaseBackup(journal.rollbackDb);
  await replaceDatabase(journal.rollbackDb, journal.dbPath);
  for (const move of [...journal.moves].reverse()) {
    if (fs.existsSync(move.old)) {
      fs.rmSync(move.target, { recursive: true, force: true });
      fs.renameSync(move.old, move.target);
    } else if (!move.hadOriginal && !fs.existsSync(move.next)) fs.rmSync(move.target, { recursive: true, force: true });
    fs.rmSync(move.next, { recursive: true, force: true });
  }
  invalidateQQMusicAccessCache();
}
function finishJournal(journal: Journal): void {
  for (const move of journal.moves) {
    fs.rmSync(move.old, { recursive: true, force: true });
    fs.rmSync(move.next, { recursive: true, force: true });
  }
  fs.rmSync(path.join(cloudBackupRoot(), "restore-journal.json"), { force: true });
  fs.rmSync(cloudRestoreGuardPath(), { force: true });
}
/** Called before background work on startup. A crashed restore stays closed until rollback succeeds. */
export async function recoverInterruptedCloudRestore(): Promise<void> {
  const file = path.join(cloudBackupRoot(), "restore-journal.json");
  if (isCloudBusy()) return;
  if (!fs.existsSync(file)) {
    // A crash before the journal was created cannot have switched any data.
    fs.rmSync(cloudRestoreGuardPath(), { force: true });
    return;
  }
  const journal = JSON.parse(fs.readFileSync(file, "utf8")) as Journal;
  validateJournal(journal);
  if (!journal.committed) await rollback(journal);
  finishJournal(journal);
  const task = getCloudTask();
  if (task?.id === journal.id) {
    task.status = journal.committed ? "completed" : "failed";
    task.phase = journal.committed ? "complete" : "restore";
    task.updatedAt = new Date().toISOString();
    if (!journal.committed) task.error = "网站进程重启，中断的恢复已回滚到恢复前的数据。";
    writeCloudTask(task);
  }
  releaseCloudLock(journal.id);
}
export async function applyCloudRestore(id: string, confirmation: string): Promise<CloudBackupTask> {
  if (confirmation !== "恢复数据") throw new Error("请填写“恢复数据”确认覆盖当前数据。");
  const download = preparedCloudDownload(id);
  const task = getCloudTask();
  if (task?.id !== id || task.kind !== "prepare" || task.status !== "completed" || task.phase !== "ready") throw new Error("云备份校验已失效，请重新下载校验。");
  const stage = cloudStage(id);
  const metadata = JSON.parse(fs.readFileSync(path.join(stage, "prepared.json"), "utf8")) as { archiveHash: string; settingsVersion: string };
  if (metadata.settingsVersion !== requireCloudSettings().version || metadata.archiveHash !== await fileHash(download.path)) throw new Error("云备份校验已失效，请重新下载校验。");
  if (countActiveArticleReferenceArchiveJobs() > 0) throw new Error("恢复失败：正文归档任务仍在执行，请完成后重试。");
  acquireCloudLock(id);
  let journal: Journal | undefined;
  let held = false;
  try {
    const content = path.join(stage, "content");
    const verified = await verifyAdminBackupContents(content);
    if (verified.schemaVersion > LATEST_DB_SCHEMA_VERSION) throw new Error("备份版本比当前网站新，请先更新网站。");
    const restoredDb = path.join(stage, "restore.db");
    fs.copyFileSync(path.join(content, "data", "blog.db"), restoredDb);
    const restored = new Database(restoredDb);
    try {
      runMigrations(restored); ensureFtsIndexes(restored);
      restored.exec("DELETE FROM sessions; DELETE FROM maintenance_leases; DELETE FROM qq_music_audio_cache;");
      restored.prepare("UPDATE auth_state SET session_generation = session_generation + 1 WHERE singleton = 1").run();
      restored.pragma("wal_checkpoint(TRUNCATE)");
    } finally { restored.close(); }
    verifyDatabaseBackup(restoredDb);
    task.status = "running"; updateCloudPhase(task, "safety");
    fs.writeFileSync(path.join(cloudBackupRoot(), "restore-epoch"), id, { mode: 0o600 });
    fs.writeFileSync(cloudRestoreGuardPath(), id, { mode: 0o600, flag: "wx" }); held = true;
    // Allow already accepted short requests to finish before taking the rollback snapshot.
    await delay(2000);
    if (countActiveArticleReferenceArchiveJobs() > 0) throw new Error("恢复失败：正文归档任务仍在执行，请完成后重试。");
    const safety = startAdminBackup();
    if (!safety.started) throw new Error("另一个本地备份任务正在执行，请稍后重试。");
    await executeAdminBackup(safety.status.id);
    const complete = getAdminBackupDownload(safety.status.id);
    if (!complete) throw new Error("备份文件生成失败，已取消恢复。");
    const safetyName = `rollback-${id}.tar.gz`;
    fs.copyFileSync(complete.path, path.join(cloudBackupRoot(), safetyName));
    fs.chmodSync(path.join(cloudBackupRoot(), safetyName), 0o600);
    task.safetyBackup = safetyName;
    const before = await runDbBackup({ backupDir: path.join(stage, "rollback-db") });
    journal = { id, dbPath: databasePath(), rollbackDb: before.path, committed: false, moves: [] };
    storeJournal(journal);
    const dataRoot = path.join(getProjectRoot(), "data");
    const fromRoot = path.join(content, "data");
    const names = new Set([...fs.readdirSync(dataRoot), ...fs.readdirSync(fromRoot)]);
    const external = externalStateFiles();
    const plan: Array<{ target: string; source: string }> = [];
    for (const name of names) {
      if ([databasePath(), `${databasePath()}-wal`, `${databasePath()}-shm`, ...external.map(file => file.target)].includes(path.join(dataRoot, name)) || preserved(name) || name.startsWith(".") || /\.yezi-[0-9a-f-]{36}\.(?:old|new)$/.test(name) || external.some(file => file.name === name)) continue;
      plan.push({ target: path.join(dataRoot, name), source: path.join(fromRoot, name) });
    }
    for (const state of external) {
      const source = path.join(fromRoot, state.name);
      if (fs.existsSync(source) || fs.existsSync(state.target)) plan.push({ target: state.target, source });
    }
    for (const item of plan) {
      if (fs.existsSync(item.target) && fs.lstatSync(item.target).isSymbolicLink()) throw new Error("恢复失败：目标包含软链接，请先核对数据目录。");
      const move: Move = { target: item.target, old: `${item.target}.yezi-${id}.old`, next: `${item.target}.yezi-${id}.new`, hadOriginal: fs.existsSync(item.target) };
      if (fs.existsSync(move.old) || fs.existsSync(move.next)) throw new Error("恢复失败：目标存在未清理的恢复临时文件。");
      journal.moves.push(move); storeJournal(journal);
      if (fs.existsSync(item.source)) fs.cpSync(item.source, move.next, { recursive: true, errorOnExist: true, force: false });
    }
    updateCloudPhase(task, "restore");
    for (const move of journal.moves) {
      if (move.hadOriginal) fs.renameSync(move.target, move.old);
      if (fs.existsSync(move.next)) fs.renameSync(move.next, move.target);
    }
    await replaceDatabase(restoredDb, journal.dbPath);
    if (db.pragma("integrity_check", { simple: true }) !== "ok" || (db.pragma("foreign_key_check") as unknown[]).length) throw new Error("恢复失败：数据库最终校验未通过。");
    invalidateQQMusicAccessCache();
    journal.committed = true; storeJournal(journal);
    finishJournal(journal); held = false;
    task.status = "completed"; updateCloudPhase(task, "complete");
    fs.rmSync(stage, { recursive: true, force: true });
    // Keep three complete pre-restore archives, independently from ordinary backup retention.
    const archives = fs.readdirSync(cloudBackupRoot()).filter(name => /^rollback-[0-9a-f-]{36}\.tar\.gz$/.test(name)).sort((a, b) => fs.statSync(path.join(cloudBackupRoot(), b)).mtimeMs - fs.statSync(path.join(cloudBackupRoot(), a)).mtimeMs);
    for (const old of archives.slice(3)) fs.rmSync(path.join(cloudBackupRoot(), old));
    return task;
  } catch (error) {
    let rollbackFailed = false;
    if (journal && !journal.committed) {
      try { await rollback(journal); finishJournal(journal); held = false; }
      catch { rollbackFailed = true; }
    }
    if (held && !rollbackFailed && !journal?.committed) fs.rmSync(cloudRestoreGuardPath(), { force: true });
    task.status = "failed"; task.error = rollbackFailed ? "恢复失败，自动回滚未完成。网站已保持维护状态，请重启网站重试回滚；恢复前的完整备份已保留。" : publicCloudError(error);
    task.updatedAt = new Date().toISOString(); writeCloudTask(task);
    throw new Error(task.error);
  } finally { releaseCloudLock(id); }
}
export function safetyCloudDownload(id: string): { path: string; size: number } {
  if (!UUID.test(id)) throw new Error("恢复备份编号无效。");
  const file = path.join(cloudBackupRoot(), `rollback-${id}.tar.gz`);
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error("恢复前备份不存在。");
  return { path: file, size: stat.size };
}
