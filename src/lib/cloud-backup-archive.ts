import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { Writable } from "node:stream";
import * as tar from "tar";
import { verifyAdminBackupContents, type AdminBackupManifest } from "@/lib/admin-backup";
import { MAX_CLOUD_BYTES } from "@/lib/webdav";

const MAGIC = Buffer.from("YEZICLOUD1");
export async function fileHash(file: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await pipeline(fs.createReadStream(file), new Writable({ write(chunk, _encoding, next) { hash.update(chunk); next(); } }));
  return hash.digest("hex");
}
export async function encryptCloudArchive(source: string, target: string, key: string): Promise<void> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  cipher.setAAD(MAGIC);
  fs.writeFileSync(target, Buffer.concat([MAGIC, iv]), { mode: 0o600, flag: "wx" });
  try {
    await pipeline(fs.createReadStream(source), cipher, fs.createWriteStream(target, { flags: "a", mode: 0o600 }));
    fs.appendFileSync(target, cipher.getAuthTag());
    if (fs.statSync(target).size > MAX_CLOUD_BYTES) throw new Error("备份超过 2 GB 上限。");
  } catch (error) { fs.rmSync(target, { force: true }); throw error; }
}
export async function decryptCloudArchive(source: string, target: string, key: string): Promise<void> {
  const size = fs.statSync(source).size;
  const header = Buffer.alloc(MAGIC.length + 12);
  const tag = Buffer.alloc(16);
  if (size <= header.length + tag.length || size > MAX_CLOUD_BYTES) throw new Error("远程备份格式或大小无效。");
  const fd = fs.openSync(source, "r");
  try { fs.readSync(fd, header, 0, header.length, 0); fs.readSync(fd, tag, 0, tag.length, size - tag.length); } finally { fs.closeSync(fd); }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("该文件不是受支持的完整云备份。");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), header.subarray(MAGIC.length));
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  try {
    // Authenticate the ENTIRE archive before passing anything to an extractor.
    await pipeline(fs.createReadStream(source, { start: header.length, end: size - tag.length - 1 }), decipher, fs.createWriteStream(target, { flags: "wx", mode: 0o600 }));
  } catch { fs.rmSync(target, { force: true }); throw new Error("恢复密钥不匹配，或远程备份已损坏。"); }
}
function safeArchivePath(value: string): boolean {
  const parts = value.replace(/\/$/, "").split("/");
  return Boolean(value) && !value.startsWith("/") && !/^[A-Za-z]:/.test(value) && !/[\\\x00-\x1f\x7f]/.test(value) && !parts.some(part => !part || part === "." || part === "..") && ["manifest.json", "RESTORE.md", "data", "config"].includes(parts[0]);
}
export async function extractAndVerifyCloudArchive(archive: string, directory: string): Promise<AdminBackupManifest> {
  const seen = new Set<string>();
  let bytes = 0;
  let invalid = false;
  await tar.t({ file: archive, strict: true, onReadEntry(entry) {
    const name = entry.path.replace(/\/$/, "");
    bytes += entry.size;
    if (!safeArchivePath(entry.path) || !["File", "Directory"].includes(entry.type) || seen.has(name) || bytes > 8 * 1024 ** 3 || seen.size >= 100_000) invalid = true;
    seen.add(name);
  } });
  if (invalid) throw new Error("备份包含不安全路径、链接、重复文件或超出解包上限。");
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  await tar.x({ file: archive, cwd: directory, strict: true, preservePaths: false, preserveOwner: false, filter: (name, entry) => safeArchivePath(name) && "type" in entry && ["File", "Directory"].includes(entry.type) });
  const secure = (root: string) => {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      const target = path.join(root, entry.name);
      if (entry.isDirectory()) { fs.chmodSync(target, 0o700); secure(target); }
      else if (entry.isFile()) fs.chmodSync(target, 0o600);
      else throw new Error("备份包含不支持的文件类型。");
    }
  };
  secure(directory);
  await verifyAdminBackupContents(directory);
  return JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8")) as AdminBackupManifest;
}
