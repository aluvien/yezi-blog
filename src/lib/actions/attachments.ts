"use server";

import { requireAdmin } from "@/lib/auth";
import {
  clearUnusedAttachments,
  compressAttachmentById,
  compressUntrackedAttachmentByPath,
  deleteAttachmentById,
  deleteUntrackedAttachmentByPath,
} from "@/lib/admin/attachments";
import type { ActionResult } from "@/lib/actions/posts";

export type CompressionProfile = "balanced" | "quality" | "small";

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/attachments。 */

export async function deleteAttachmentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return deleteAttachmentById(id);
}

export async function deleteUntrackedAttachmentAction(relativePath: string): Promise<ActionResult> {
  await requireAdmin();
  return deleteUntrackedAttachmentByPath(relativePath);
}

export async function clearUnusedAttachmentsAction(): Promise<ActionResult> {
  await requireAdmin();
  return clearUnusedAttachments();
}

export async function compressAttachmentAction(id: number, profile: CompressionProfile = "balanced"): Promise<ActionResult> {
  await requireAdmin();
  return compressAttachmentById(id, profile);
}

export async function compressUntrackedAttachmentAction(relativePath: string, profile: CompressionProfile = "balanced"): Promise<ActionResult> {
  await requireAdmin();
  return compressUntrackedAttachmentByPath(relativePath, profile);
}
