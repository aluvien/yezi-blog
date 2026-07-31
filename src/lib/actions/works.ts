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
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export async function createWorkAction(data: WorkInput): Promise<ActionResult> {
  await requireAdmin();
  if (!data.title.trim()) return { ok: false, error: "请填写标题" };
  if (!validOptionalUrl(data.link)) return { ok: false, error: "作品链接必须是有效的 http/https 地址" };
  createWork({
    title: data.title.trim(),
    description: data.description,
    cover: data.cover,
    link: data.link.trim() || null,
    sort_order: data.sort_order,
  });
  revalidatePath("/admin/works");
  revalidatePath("/works");
  revalidatePath("/");
  return { ok: true };
}

export async function updateWorkAction(id: number, data: WorkInput): Promise<ActionResult> {
  await requireAdmin();
  if (!getWork(id)) return { ok: false, error: "作品不存在" };
  if (!data.title.trim()) return { ok: false, error: "请填写标题" };
  if (!validOptionalUrl(data.link)) return { ok: false, error: "作品链接必须是有效的 http/https 地址" };
  updateWork(id, {
    title: data.title.trim(),
    description: data.description,
    cover: data.cover,
    link: data.link.trim() || null,
    sort_order: data.sort_order,
  });
  revalidatePath("/admin/works");
  revalidatePath("/works");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteWorkAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  if (!getWork(id)) return { ok: false, error: "作品不存在" };
  deleteWork(id);
  revalidatePath("/admin/works");
  revalidatePath("/works");
  revalidatePath("/");
  return { ok: true };
}
