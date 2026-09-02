"use server";

import { requireAdmin } from "@/lib/auth";
import {
  approveCommentById,
  deleteCommentById,
  hideCommentById,
  replyCommentById,
} from "@/lib/admin/comments";
import type { ActionResult } from "@/lib/actions/posts";

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/comments。 */

export async function approveCommentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return approveCommentById(id);
}

export async function hideCommentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return hideCommentById(id);
}

export async function replyCommentAction(id: number, rawReply: string): Promise<ActionResult> {
  await requireAdmin();
  return replyCommentById(id, rawReply);
}

export async function deleteCommentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return deleteCommentById(id);
}
