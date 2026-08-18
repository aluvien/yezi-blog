"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { createWork, deleteWork, getWork, updateWork } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";

export interface WorkInput {
  title: string;
  description: string;
  cover: string | null;
  link: string;
  sort_order: number;
}

function validOptionalUrl(value: string): boolean {
  if (!value.trim()) return true;
  if (value.trim().length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateWork(data: WorkInput): string | null {
  if (!data || typeof data !== "object" || typeof data.title !== "string" || typeof data.description !== "string" || typeof data.link !== "string" || !(data.cover === null || typeof data.cover === "string")) {
    return "作品数据格式无效";
  }
  const title = String(data.title ?? "").trim();
  if (!title) return "请填写标题";
  if (title.length > 240) return "标题不能超过 240 个字符";
  if (String(data.description ?? "").length > 5_000) return "作品介绍不能超过 5000 个字符";
  if (!validOptionalUrl(String(data.link ?? ""))) return "作品链接必须是有效的 http/https 地址";
  if (data.cover && !validOptionalUrl(data.cover) && !data.cover.startsWith("/uploads/")) return "封面地址无效";
  if (!Number.isFinite(data.sort_order) || Math.abs(data.sort_order) > 1_000_000) return "排序值无效";
  return null;
}

export async function createWorkAction(data: WorkInput): Promise<ActionResult> {
  await requireAdmin();
  const validationError = validateWork(data);
  if (validationError) return { ok: false, error: validationError };
  const work = createWork({
    title: data.title.trim(),
    description: data.description,
    cover: data.cover,
    link: data.link.trim() || null,
    sort_order: Math.trunc(data.sort_order),
  });
  revalidatePath("/admin/works");
  revalidatePath("/works");
  revalidatePath("/");
  return { ok: true, data: work };
}

export async function updateWorkAction(id: number, data: WorkInput): Promise<ActionResult> {
  await requireAdmin();
  if (!getWork(id)) return { ok: false, error: "作品不存在" };
  const validationError = validateWork(data);
  if (validationError) return { ok: false, error: validationError };
  const work = updateWork(id, {
    title: data.title.trim(),
    description: data.description,
    cover: data.cover,
    link: data.link.trim() || null,
    sort_order: Math.trunc(data.sort_order),
  });
  revalidatePath("/admin/works");
  revalidatePath("/works");
  revalidatePath("/");
  return { ok: true, data: work };
}

export async function deleteWorkAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  if (!getWork(id)) return { ok: false, error: "作品不存在" };
  deleteWork(id);
  revalidatePath("/admin/works");
  revalidatePath("/works");
  revalidatePath("/");
  return { ok: true, data: { id } };
}
