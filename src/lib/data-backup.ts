import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { runDbBackup } from "@/lib/backup";
import { verifyDatabaseBackup } from "@/lib/backup-verification";
import { getProjectRoot } from "@/lib/uploads";

const MAGIC = Buffer.from("YEZI-DATA-BACKUP-v1\0", "ascii");
const DEFAULT_KEEP = 14;

export type CompleteDataBackupResult = {
  path: string;
  mirroredPath?: string;
  databaseSnapshot: string;
  cleaned: string[];
};

function encryptionKey(): Buffer {
  const raw = process.env.DATA_BACKUP_KEY?.trim() ?? "";
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32 || key.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw new Error("DATA_BACKUP_KEY 必须是 32 字节随机密钥的 base64 编码");
  }
  return key;
}

function safeMirrorDirectory(stateRoot: string): string | null {
  const configured = process.env.DATA_BACKUP_MIRROR_DIR?.trim();
  if (!configured) return null;
  const target = path.resolve(configured);
  const state = path.resolve(stateRoot);
  if (target === state || target.startsWith(`${state}${path.sep}`)) {
    throw new Error("异机镜像目录不能位于 BLOG_ROOT/data 的同一故障域内");
  }
  return target;
}

async function copyPersistentData(dataRoot: string, stagingData: string): Promise<void> {
  if (!fs.existsSync(dataRoot)) return;
  await fs.promises.cp(dataRoot, stagingData, {
    recursive: true,
    force: false,
    errorOnExist: false,
    filter(source) {
      const relative = path.relative(dataRoot, source);
      if (!relative) return true;
      const first = relative.split(path.sep, 1)[0];
      if (first === "backups") return false;
      if (/^blog\.db(?:-wal|-shm)?$/.test(relative)) return false;
      if (/\.tmp$/.test(relative)) return false;
      return true;
    },
  });
}

async function encryptedTar(stagingRoot: string, destination: string, key: Buffer): Promise<void> {
  const temporary = `${destination}.${process.pid}.tmp`;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  fs.writeFileSync(temporary, Buffer.concat([MAGIC, iv]), { mode: 0o600 });
  const tar = spawn("tar", ["-czf", "-", "-C", stagingRoot, "manifest.json", "data"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tarExit = new Promise((resolve) => tar.once("close", resolve));
  const stderr: Buffer[] = [];
  tar.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  try {
    await pipeline(tar.stdout, cipher, fs.createWriteStream(temporary, { flags: "a", mode: 0o600 }));
    const exitCode = await tarExit;
    if (exitCode !== 0) throw new Error(`tar 归档失败：${Buffer.concat(stderr).toString("utf8").trim().slice(-500)}`);
    fs.appendFileSync(temporary, cipher.getAuthTag());
    fs.renameSync(temporary, destination);
    fs.chmodSync(destination, 0o600);
  } catch (error) {
    tar.kill("SIGKILL");
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

function applyRetention(directory: string, keep: number): string[] {
  if (!fs.existsSync(directory)) return [];
  const stale = fs.readdirSync(directory)
    .filter((name) => /^data-.*\.tar\.gz\.enc$/.test(name))
    .map((name) => ({ name, mtime: fs.statSync(path.join(directory, name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
    .slice(keep);
  for (const item of stale) fs.rmSync(path.join(directory, item.name), { force: true });
  return stale.map((item) => item.name);
}

export async function runCompleteDataBackup(options: { keep?: number } = {}): Promise<CompleteDataBackupResult> {
  const key = encryptionKey();
  const stateRoot = getProjectRoot();
  const dataRoot = path.join(stateRoot, "data");
  const backupRoot = path.join(dataRoot, "backups");
  fs.mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
  const lockPath = path.join(backupRoot, ".data-backup.lock");
  let lockFd: number;
  try {
    lockFd = fs.openSync(lockPath, "wx", 0o600);
  } catch {
    throw new Error("已有完整数据备份正在执行");
  }

  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-data-backup-"));
  try {
    const database = await runDbBackup();
    const stagingData = path.join(stagingRoot, "data");
    await copyPersistentData(dataRoot, stagingData);
    fs.mkdirSync(stagingData, { recursive: true, mode: 0o700 });
    fs.copyFileSync(database.path, path.join(stagingData, "blog.db"));
    fs.chmodSync(path.join(stagingData, "blog.db"), 0o600);
    const manifest = {
      format: 1,
      createdAt: new Date().toISOString(),
      database: { file: "data/blog.db", schemaVersion: database.verification.schemaVersion },
      excludes: ["data/blog.db-wal", "data/blog.db-shm", "data/backups", "*.tmp"],
    };
    fs.writeFileSync(path.join(stagingRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });

    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "");
    const name = `data-${stamp}-${crypto.randomBytes(4).toString("hex")}.tar.gz.enc`;
    const destination = path.join(backupRoot, name);
    await encryptedTar(stagingRoot, destination, key);

    const mirror = safeMirrorDirectory(stateRoot);
    let mirroredPath: string | undefined;
    if (mirror) {
      fs.mkdirSync(mirror, { recursive: true, mode: 0o700 });
      const temporaryMirror = path.join(mirror, `${name}.${process.pid}.tmp`);
      fs.copyFileSync(destination, temporaryMirror);
      fs.chmodSync(temporaryMirror, 0o600);
      mirroredPath = path.join(mirror, name);
      fs.renameSync(temporaryMirror, mirroredPath);
    }

    const parsedKeep = Math.trunc(options.keep ?? Number(process.env.DATA_BACKUP_KEEP));
    const keep = Number.isFinite(parsedKeep) && parsedKeep > 0 ? parsedKeep : DEFAULT_KEEP;
    const cleaned = applyRetention(backupRoot, keep);
    if (mirror) cleaned.push(...applyRetention(mirror, keep).map((item) => `mirror:${item}`));
    return { path: destination, mirroredPath, databaseSnapshot: database.path, cleaned };
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    fs.closeSync(lockFd!);
    fs.rmSync(lockPath, { force: true });
  }
}

export function completeBackupMagic(): Buffer {
  return Buffer.from(MAGIC);
}

export async function verifyCompleteDataBackup(inputPath: string): Promise<{ path: string; files: number; entries: string[]; schemaVersion: number }> {
  const source = path.resolve(inputPath);
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size <= MAGIC.length + 12 + 16) throw new Error("完整数据备份不存在或过小");
  const descriptor = fs.openSync(source, "r");
  const header = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  try {
    fs.readSync(descriptor, header, 0, header.length, 0);
    fs.readSync(descriptor, tag, 0, tag.length, stat.size - tag.length);
  } finally {
    fs.closeSync(descriptor);
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("完整数据备份格式无效");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), header.subarray(MAGIC.length));
  decipher.setAuthTag(tag);
  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), "yezi-data-verify-"));
  const tar = spawn("tar", ["-xzf", "-", "-C", extractRoot], { stdio: ["pipe", "ignore", "pipe"] });
  const tarExit = new Promise((resolve) => tar.once("close", resolve));
  const stderr: Buffer[] = [];
  tar.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  try {
    await pipeline(
      fs.createReadStream(source, { start: header.length, end: stat.size - tag.length - 1 }),
      decipher,
      tar.stdin,
    );
    const exitCode = await tarExit;
    if (exitCode !== 0) throw new Error(`完整数据归档无法解包：${Buffer.concat(stderr).toString("utf8").trim().slice(-500)}`);
    const manifest = JSON.parse(fs.readFileSync(path.join(extractRoot, "manifest.json"), "utf8")) as { format?: number };
    if (manifest.format !== 1) throw new Error("完整数据备份 manifest 版本不支持");
    const verification = verifyDatabaseBackup(path.join(extractRoot, "data", "blog.db"));
    const entries: string[] = [];
    const count = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        if (entry.isDirectory()) count(path.join(directory, entry.name));
        else entries.push(path.relative(extractRoot, path.join(directory, entry.name)).split(path.sep).join("/"));
      }
    };
    count(path.join(extractRoot, "data"));
    entries.sort();
    return { path: source, files: entries.length, entries, schemaVersion: verification.schemaVersion };
  } finally {
    tar.kill("SIGKILL");
    fs.rmSync(extractRoot, { recursive: true, force: true });
  }
}
