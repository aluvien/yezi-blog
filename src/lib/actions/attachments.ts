"use server";

import fs from "fs";
import path from "path";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { deleteAttachment, listAttachments } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";

function attachmentAbsolutePath(relativePath: string): string | null {
  if (!relativePath.startsWith("/uploads/")) return null;
  const publicRoot = path.resolve(process.cwd(), "public");
  const target = path.resolve(publicRoot, relativePath.slice(1));
  if (!target.startsWith(`${publicRoot}${path.sep}`)) return null;
  return target;
}

function removeAttachmentFile(relativePath: string): void {
  const target = attachmentAbsolutePath(relativePath);
  if (target && fs.existsSync(target)) fs.unlinkSync(target);
}

function revalidateAttachmentPages() {
  revalidatePath("/admin/attachments");
  revalidatePath("/admin/posts");
}

export async function deleteAttachmentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  const usage = listAttachments().find((attachment) => attachment.id === id);
  if (!usage) return { ok: false, error: "附件不存在" };
  if (usage.referenced) return { ok: false, error: "附件正在文章中使用，请先移除引用" };
  const attachment = deleteAttachment(id);
  if (!attachment) return { ok: false, error: "附件不存在" };
  removeAttachmentFile(attachment.path);
  revalidateAttachmentPages();
  return { ok: true };
}

export async function clearUnusedAttachmentsAction(): Promise<ActionResult> {
  await requireAdmin();
  const unused = listAttachments().filter((attachment) => !attachment.referenced);
  for (const attachment of unused) {
    const deleted = deleteAttachment(attachment.id);
    if (deleted) removeAttachmentFile(deleted.path);
  }
  revalidateAttachmentPages();
  return { ok: true };
}
