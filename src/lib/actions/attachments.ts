"use server";

import fs from "fs";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { deleteAttachment, listAttachments } from "@/lib/db";
import { uploadAbsolutePath } from "@/lib/uploads";
import type { ActionResult } from "@/lib/actions/posts";

function removeAttachmentFile(relativePath: string): void {
  const target = uploadAbsolutePath(relativePath);
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
