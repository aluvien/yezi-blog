import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createAttachment, db, deleteAttachment } from "@/lib/db";
import type { AttachmentWithUsage } from "@/lib/db";
import { attachmentReferences, attachmentSources } from "@/lib/attachment-usage";
import { getProjectRoot, getUploadDir, uploadAbsolutePath } from "@/lib/uploads";
import { withDataFileMutation } from "@/lib/data-files-lock";

export type TrashedAttachment = {
  id: string; path: string; original_name: string; mime_type: string; size: number;
  post_id: number | null; tracked: boolean; deletedAt: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function root(): string { return path.join(getProjectRoot(), "data", "attachment-trash"); }
function directory(id: string): string {
  if (!UUID.test(id)) throw new Error("回收站编号无效");
  const target = path.join(root(), id);
  for (const file of [root(), target]) if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) throw new Error("回收站路径无效");
  return target;
}
function safeTarget(webPath: string): string {
  const target = uploadAbsolutePath(webPath);
  if (!target || !webPath.startsWith("/uploads/")) throw new Error("附件路径无效");
  for (let current = target; current.startsWith(getUploadDir()); current = path.dirname(current)) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error("附件路径包含软链接");
  }
  return target;
}
function read(id: string): TrashedAttachment {
  const folder = directory(id);
  const meta = path.join(folder, "metadata.json");
  const file = path.join(folder, "file");
  if (!fs.lstatSync(meta).isFile() || !fs.lstatSync(file).isFile()) throw new Error("回收站文件不存在");
  const value = JSON.parse(fs.readFileSync(meta, "utf8")) as TrashedAttachment;
  if (value.id !== id || typeof value.path !== "string" || typeof value.original_name !== "string" || typeof value.mime_type !== "string" || !Number.isFinite(value.size) || typeof value.tracked !== "boolean" || !Number.isFinite(Date.parse(value.deletedAt)) || (value.post_id !== null && !Number.isSafeInteger(value.post_id))) throw new Error("回收站记录无效");
  safeTarget(value.path);
  return { ...value, size: fs.statSync(file).size };
}
export function listTrashedAttachments(): TrashedAttachment[] {
  if (!fs.existsSync(root()) || fs.lstatSync(root()).isSymbolicLink()) return [];
  const result: TrashedAttachment[] = [];
  for (const item of fs.readdirSync(root(), { withFileTypes: true })) {
    if (!item.isDirectory() || !UUID.test(item.name)) continue;
    try { result.push(read(item.name)); } catch { /* Preserve damaged entries for manual recovery. */ }
  }
  return result.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/** Caller holds the file lease. Keep recovery metadata until both file and row are removed. */
export async function trashAttachment(attachment: AttachmentWithUsage): Promise<void> {
  const target = safeTarget(attachment.path);
  if (attachmentReferences(attachment.path, attachmentSources(db)).length) throw new Error("附件正在网站中使用，请先移除引用");
  if (!fs.existsSync(target)) {
    if (attachment.tracked) deleteAttachment(attachment.id);
    return;
  }
  const id = crypto.randomUUID();
  const folder = directory(id);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const entry: TrashedAttachment = { id, path: attachment.path, original_name: attachment.original_name, mime_type: attachment.mime_type, size: attachment.size, post_id: attachment.post_id, tracked: attachment.tracked, deletedAt: new Date().toISOString() };
  fs.writeFileSync(path.join(folder, "metadata.json"), JSON.stringify(entry), { mode: 0o600 });
  const file = path.join(folder, "file");
  let moved = false;
  try {
    await fs.promises.rename(target, file); moved = true;
    // A content save may have referenced the image while rename was in flight.
    if (attachmentReferences(attachment.path, attachmentSources(db)).length) throw new Error("附件正在网站中使用，请先移除引用");
    if (attachment.tracked && !deleteAttachment(attachment.id)) throw new Error("附件记录已发生变化");
  } catch (error) {
    if (moved) {
      try { await fs.promises.rename(file, target); }
      catch { throw new Error(`附件删除失败且原位恢复失败，文件已保留在回收站：${file}`); }
    }
    fs.rmSync(folder, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreTrashedAttachment(id: string, epoch?: string): Promise<void> {
  await withDataFileMutation(async () => {
    const entry = read(id);
    const folder = directory(id);
    const file = path.join(folder, "file");
    const target = safeTarget(entry.path);
    if (fs.existsSync(target)) throw new Error("原位置已有同名文件，未覆盖，请先核对附件");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // COPYFILE_EXCL prevents a competing external writer from being overwritten.
    fs.copyFileSync(file, target, fs.constants.COPYFILE_EXCL);
    try {
      const existing = db.prepare("SELECT id FROM attachments WHERE path = ?").get(entry.path);
      if (entry.tracked && !existing) createAttachment({ path: entry.path, original_name: entry.original_name, mime_type: entry.mime_type, size: entry.size, post_id: entry.post_id && db.prepare("SELECT id FROM posts WHERE id = ?").get(entry.post_id) ? entry.post_id : null });
    } catch (error) { fs.rmSync(target, { force: true }); throw error; }
    fs.rmSync(folder, { recursive: true, force: true });
  }, epoch);
}
