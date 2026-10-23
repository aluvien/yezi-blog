import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { attachmentSources, referencedUploadPaths } from "./attachment-usage";

/** Validate a detached snapshot, never a live WAL database. */
export function verifyNativeBackupUploads(databasePath: string, uploadDirectory: string): void {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const expected = new Map<string, number | undefined>(referencedUploadPaths(attachmentSources(database)).map(value => [value, undefined]));
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'attachments'").get()) {
      const attachments = database.prepare("SELECT path, size FROM attachments").all() as Array<{ path: string; size: number }>;
      for (const attachment of attachments) {
        if (!attachment.path.startsWith("/uploads/") || !Number.isSafeInteger(attachment.size) || attachment.size < 0) throw new Error("备份附件记录无效");
        expected.set(decodeURIComponent(attachment.path), attachment.size);
      }
    }
    const root = path.resolve(uploadDirectory);
    for (const [name, size] of expected) {
      const absolute = path.resolve(root, name.slice("/uploads/".length));
      try {
        if (!absolute.startsWith(root + path.sep)) throw new Error("路径越界");
        const stat = fs.lstatSync(absolute);
        if (!stat.isFile() || !fs.realpathSync(absolute).startsWith(fs.realpathSync(root) + path.sep) || (size !== undefined && stat.size !== size)) throw new Error("文件不一致");
      } catch { throw new Error(`备份附件一致性校验失败：${name}`); }
    }
  } finally {
    database.close();
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(databasePath + suffix, { force: true });
  }
}
