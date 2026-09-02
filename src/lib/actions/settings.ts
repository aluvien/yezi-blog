"use server";

import { revalidatePath } from "next/cache";
import { deleteCategory } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import {
  createCategoryByName,
  deleteCategoryById,
  deleteTag,
  renameTag,
  updateCategoryById,
  updateSiteSettings,
} from "@/lib/admin/settings";

export type SettingsActionResult = { ok: true; data?: unknown } | { ok: false; error: string };

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/settings。 */

export async function updateSiteSettingsAction(values: Record<string, string>): Promise<SettingsActionResult> {
  await requireAdmin();
  return updateSiteSettings(values);
}

export async function createCategoryAction(formData: FormData): Promise<void> {
  await createCategoryByNameAction(String(formData.get("name") ?? ""));
}

/** 分类管理网页与原生 API 共用的创建校验。 */
export async function createCategoryByNameAction(name: string): Promise<SettingsActionResult> {
  await requireAdmin();
  return createCategoryByName(name);
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id < 1) return;
  deleteCategory(id);
  revalidatePath("/admin/categories");
  revalidatePath("/", "layout");
}

export async function updateCategoryAction(id: number, name: string): Promise<SettingsActionResult> {
  await requireAdmin();
  return updateCategoryById(id, name);
}

export async function deleteCategoryByIdAction(id: number): Promise<SettingsActionResult> {
  await requireAdmin();
  return deleteCategoryById(id);
}

export async function renameTagAction(oldTag: string, newTag: string): Promise<SettingsActionResult> {
  await requireAdmin();
  return renameTag(oldTag, newTag);
}

export async function deleteTagAction(tag: string): Promise<SettingsActionResult> {
  await requireAdmin();
  return deleteTag(tag);
}
