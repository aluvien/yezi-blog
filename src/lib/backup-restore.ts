import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pipeline } from "node:stream/promises";
import Database from "better-sqlite3";
import { getProjectRoot } from "./uploads";
import { verifyDatabaseBackup } from "./backup-verification";
import { verifyNativeBackupUploads } from "./native-backup-verification";
import type { BackupKind } from "./backup-management";
const run = promisify(execFile);
const magic = Buffer.from("YEZI-DATA-BACKUP-v1\0", "ascii");
const excluded = new Set(["backups", "backup-jobs", "qq-music-audio", "npm-cache"]);
const durable = (name: string) => !excluded.has(name) && !name.startsWith(".") && !name.endsWith(".tmp") && !/^deploy(?:[.-]|$)/.test(name) && !/^blog\.db-(wal|shm)$/.test(name);
export type PreparedRestore = { root: string; database: string; kind: BackupKind; cleanup: () => void };
function noLinks(root: string) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) throw new Error("备份包含不支持的特殊文件");
    if (entry.isDirectory()) noLinks(path.join(root, entry.name));
  }
}
export async function prepareRestore(source: string, kind: BackupKind): Promise<PreparedRestore> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-restore-"));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  try {
    const target = path.join(root, "data"); fs.mkdirSync(target);
    const database = path.join(target, "blog.db");
    if (kind === "database") fs.copyFileSync(source, database);
    else {
      const key = Buffer.from(process.env.DATA_BACKUP_KEY?.trim() || "", "base64");
      if (key.length !== 32) throw new Error("服务器完整备份密钥未配置");
      const fd = fs.openSync(source, "r"); const size = fs.fstatSync(fd).size;
      const header = Buffer.alloc(magic.length + 12); const tag = Buffer.alloc(16);
      try { fs.readSync(fd, header, 0, header.length, 0); fs.readSync(fd, tag, 0, 16, size - 16); } finally { fs.closeSync(fd); }
      if (!header.subarray(0, magic.length).equals(magic)) throw new Error("备份格式无效");
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, header.subarray(magic.length)); decipher.setAuthTag(tag);
      const archive = path.join(root, "archive.tar.gz");
      // Authenticate the complete archive before tar is allowed to extract anything.
      await pipeline(fs.createReadStream(source, { start: header.length, end: size - 17 }), decipher, fs.createWriteStream(archive, { mode: 0o600 }));
      const entries = (await run("tar", ["-tzf", archive], { maxBuffer: 32 * 1024 * 1024 })).stdout.split("\n").filter(Boolean);
      if (entries.some(entry => entry.startsWith("/") || entry.split("/").includes("..") || (entry !== "manifest.json" && entry !== "data" && !entry.startsWith("data/")))) throw new Error("备份包含越界路径");
      const types = (await run("tar", ["-tvzf", archive], { maxBuffer: 32 * 1024 * 1024 })).stdout.split("\n").filter(Boolean);
      if (types.some(line => !["-", "d"].includes(line[0]))) throw new Error("备份不能包含链接或设备文件");
      await run("tar", ["-xzf", archive, "-C", root], { maxBuffer: 1024 * 1024 });
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
      if (manifest.format !== 1) throw new Error("备份版本不支持");
      noLinks(target);
      verifyNativeBackupUploads(database, path.join(target, "uploads"));
    }
    const candidate = verifyDatabaseBackup(database);
    const livePath = path.resolve(process.env.BLOG_DB_PATH || path.join(getProjectRoot(), "data/blog.db"));
    if (kind === "complete" && livePath !== path.join(getProjectRoot(), "data/blog.db")) throw new Error("完整恢复暂不支持外置数据库路径");
    // Never run the readonly verifier on the live WAL database: it removes sidecars.
    const live = new Database(livePath, { readonly: true, fileMustExist: true });
    try {
      if (candidate.schemaVersion > Number(live.pragma("user_version", { simple: true }))) throw new Error("备份数据库版本比当前网站更新，请先升级网站");
    } finally { live.close(); }
    if (kind === "database") verifyNativeBackupUploads(database, path.join(getProjectRoot(), "data/uploads"));
    const restored = new Database(database);
    try { restored.prepare("DELETE FROM sessions").run(); restored.pragma("wal_checkpoint(TRUNCATE)"); } finally { restored.close(); }
    return { root, database, kind, cleanup };
  } catch (error) { cleanup(); throw error; }
}
/** Caller must have stopped every website process and created a safety backup. */
export function replaceOfflineData(prepared: PreparedRestore, id: string) {
  if (!/^[a-f0-9-]+$/.test(id)) throw new Error("恢复任务标识无效");
  const liveRoot = path.join(getProjectRoot(), "data");
  const database = path.resolve(process.env.BLOG_DB_PATH || path.join(liveRoot, "blog.db"));
  const recovery = path.join(liveRoot, "backup-jobs", `recovery-${id}`); fs.mkdirSync(recovery, { recursive: true, mode: 0o700 });
  if (prepared.kind === "complete" && database !== path.join(liveRoot, "blog.db")) throw new Error("完整恢复暂不支持外置数据库路径");
  const sourceRoot = path.dirname(prepared.database);
  const names = prepared.kind === "database" ? ["blog.db"] : [...new Set([...fs.readdirSync(liveRoot), ...fs.readdirSync(sourceRoot)].filter(durable))];
  const journal: Array<{ target: string; previous: string; existed: boolean; installed: boolean }> = [];
  const save = () => fs.writeFileSync(path.join(recovery, "journal.json"), JSON.stringify(journal), { mode: 0o600 });
  const rollback = () => {
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(database + suffix, { force: true });
    for (const item of [...journal].reverse()) {
      if (item.installed) fs.rmSync(item.target, { recursive: true, force: true });
      if (fs.existsSync(item.previous)) fs.renameSync(item.previous, item.target);
    }
  };
  try {
    for (const suffix of ["-wal", "-shm"]) {
      const file = database + suffix;
      if (fs.existsSync(file)) { const previous = path.join(recovery, "blog.db" + suffix); journal.push({ target: file, previous, existed: true, installed: false }); save(); fs.renameSync(file, previous); }
    }
    for (const name of names) {
      const target = name === "blog.db" ? database : path.join(liveRoot, name);
      const source = path.join(sourceRoot, name); const previous = path.join(recovery, name);
      const item = { target, previous, existed: fs.existsSync(target), installed: false }; journal.push(item); save();
      if (item.existed) fs.renameSync(target, previous);
      if (fs.existsSync(source)) { item.installed = true; save(); fs.cpSync(source, target, { recursive: true, dereference: false }); }
    }
    return { rollback, commit: () => { fs.writeFileSync(path.join(recovery, "completed"), new Date().toISOString(), { mode: 0o600 }); } };
  } catch (error) { rollback(); throw error; }
}
