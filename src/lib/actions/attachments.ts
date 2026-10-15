"use server";

import { currentDataEpoch } from "@/lib/cloud-restore-guard";
import { requireAdmin } from "@/lib/auth";
import {
  restoreAttachmentFromTrash,
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
  const epoch = currentDataEpoch();
  await requireAdmin();
  return deleteAttachmentById(id, epoch);
}

export async function deleteUntrackedAttachmentAction(relativePath: string): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  return deleteUntrackedAttachmentByPath(relativePath, epoch);
}

export async function clearUnusedAttachmentsAction(): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  return clearUnusedAttachments(epoch);
}

export async function compressAttachmentAction(id: number, profile: CompressionProfile = "balanced"): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  return compressAttachmentById(id, profile, epoch);
}

export async function compressUntrackedAttachmentAction(relativePath: string, profile: CompressionProfile = "balanced"): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  return compressUntrackedAttachmentByPath(relativePath, profile, epoch);
}

export async function restoreAttachmentAction(id: string): Promise<ActionResult> {
  const epoch = currentDataEpoch();
  await requireAdmin();
  return restoreAttachmentFromTrash(id, epoch);
}
