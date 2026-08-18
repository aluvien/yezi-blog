"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import {
  approveComment,
  deleteComment,
  getComment,
  getPost,
  hideComment,
  updateCommentReply,
} from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";

function revalidateCommentTarget(comment: NonNullable<ReturnType<typeof getComment>>): void {
  revalidatePath("/");
  if (comment.target_type === "moment") {
    revalidatePath("/moments");
    return;
  }
  const post = getPost(comment.target_id);
  if (post) revalidatePath(`/posts/${post.slug}`);
}

export async function approveCommentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  const comment = getComment(id);
  if (!comment) return { ok: false, error: "评论不存在" };
  approveComment(id);
  revalidatePath("/admin/comments");
  revalidatePath("/admin");
  revalidateCommentTarget(comment);
  return { ok: true, data: getComment(id) };
}

export async function hideCommentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  const comment = getComment(id);
  if (!comment) return { ok: false, error: "评论不存在" };
  hideComment(id);
  revalidatePath("/admin/comments");
  revalidatePath("/admin");
  revalidateCommentTarget(comment);
  return { ok: true, data: getComment(id) };
}

export async function replyCommentAction(id: number, rawReply: string): Promise<ActionResult> {
  await requireAdmin();
  const comment = getComment(id);
  if (!comment) return { ok: false, error: "评论不存在" };
  const reply = rawReply.trim();
  if (reply.length > 1000) return { ok: false, error: "回复不能超过 1000 字" };
  updateCommentReply(id, reply || null);
  revalidatePath("/admin/comments");
  revalidateCommentTarget(comment);
  return { ok: true, data: getComment(id) };
}

export async function deleteCommentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  const comment = getComment(id);
  if (!comment) return { ok: false, error: "评论不存在" };
  deleteComment(id);
  revalidatePath("/admin/comments");
  revalidatePath("/admin");
  revalidateCommentTarget(comment);
  return { ok: true, data: { id } };
}
