"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createMoment, deleteMoment, getMoment, updateMoment } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";

const MAX_MOMENT_CONTENT_LENGTH = 20_000;

function normalizeMomentImages(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 9) return null;
  const images = value.map((item) => String(item ?? "").trim());
  const valid = images.every((image) => {
    if (!image || image.length > 2_000) return false;
    if (image.startsWith("/uploads/") && !image.startsWith("//")) return true;
    try {
      const url = new URL(image);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
  return valid ? [...new Set(images)] : null;
}

export async function createMomentAction(data: { content: string; images: string[] }): Promise<ActionResult> {
  await requireAdmin();
  if (!data || typeof data.content !== "string") return { ok: false, error: "想法数据格式无效" };
  const content = data.content.trim();
  if (content.length > MAX_MOMENT_CONTENT_LENGTH) return { ok: false, error: "想法内容不能超过 2 万个字符" };
  const images = normalizeMomentImages(data.images);
  if (!images) return { ok: false, error: "图片地址无效或数量超过 9 张" };
  if (!content && images.length === 0) return { ok: false, error: "写点什么或至少传一张图" };
  createMoment({ content, images });
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
  if (!Number.isInteger(id) || id < 1 || !data || typeof data.content !== "string") return { ok: false, error: "想法数据格式无效" };
  if (!getMoment(id)) return { ok: false, error: "想法不存在" };
  const content = data.content.trim();
  if (content.length > MAX_MOMENT_CONTENT_LENGTH) return { ok: false, error: "想法内容不能超过 2 万个字符" };
  const images = normalizeMomentImages(data.images);
  if (!images) return { ok: false, error: "图片地址无效或数量超过 9 张" };
  if (!content && images.length === 0) return { ok: false, error: "写点什么或至少保留一张图" };
  updateMoment(id, { content, images });
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
