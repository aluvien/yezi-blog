import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { attachmentSources, referencedUploadPaths } from "@/lib/attachment-usage";

export function verifyBackupUploads(dataRoot: string): void {
  const database = new Database(path.join(dataRoot, "blog.db"), { readonly: true, fileMustExist: true });
  try {
    const uploads = path.join(dataRoot, "uploads");
    for (const reference of referencedUploadPaths(attachmentSources(database))) {
      const target = path.resolve(dataRoot, `.${reference}`);
      if (!target.startsWith(`${uploads}${path.sep}`) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw new Error(`备份缺少内容引用的附件：${reference}`);
      }
    }
  } finally {
    database.close();
    // Readonly SQLite may create sidecars when opening a WAL-mode snapshot.
    for (const suffix of ["-wal", "-shm"]) fs.rmSync(path.join(dataRoot, `blog.db${suffix}`), { force: true });
  }
}
