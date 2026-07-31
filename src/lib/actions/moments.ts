"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createMoment, deleteMoment, getMoment, updateMoment } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";

export async function createMomentAction(data: { content: string; images: string[] }): Promise<ActionResult> {
  await requireAdmin();
  const content = data.content.trim();
  if (!content && data.images.length === 0) return { ok: false, error: "写点什么或至少传一张图" };
  createMoment({ content, images: data.images.slice(0, 9) });
  revalidatePath("/admin/moments");
  revalidatePath("/moments");
  revalidatePath("/");
  return { ok: true };
}

export async function updateMomentAction(
  id: number,
  data: { content: string; images: string[] },
): Promise<ActionResult> {
  await requireAdmin();
  if (!getMoment(id)) return { ok: false, error: "想法不存在" };
  const content = data.content.trim();
  if (!content && data.images.length === 0) return { ok: false, error: "写点什么或至少保留一张图" };
  updateMoment(id, { content, images: data.images.slice(0, 9) });
  revalidatePath("/admin/moments");
  revalidatePath("/moments");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteMomentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  if (!getMoment(id)) return { ok: false, error: "想法不存在" };
  deleteMoment(id);
  revalidatePath("/admin/moments");
  revalidatePath("/moments");
  revalidatePath("/");
  return { ok: true };
}
