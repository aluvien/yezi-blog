"use server";

import { revalidatePath } from "next/cache";
import { createCategory, deleteCategory, getSiteSettings, setSiteSettings } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export type SettingsActionResult = { ok: true } | { ok: false; error: string };

const SETTING_KEYS = [
  "site_name",
  "site_subtitle",
  "site_logo",
  "site_logo_no_border",
  "footer_text",
  "social_links",
  "show_related_posts",
  "show_more_posts",
  "show_table_of_contents",
  "author_email",
  "gravatar_mirror",
  "author_avatar",
  "author_avatar_no_border",
  "about_content",
  "meting_api",
  "default_music",
  "theme",
  "dark_mode",
] as const;

export async function updateSiteSettingsAction(values: Record<string, string>): Promise<SettingsActionResult> {
  await requireAdmin();
  // 只更新本次提交的键：缺失的键保留数据库现有值。
  // （客户端表单总是提交全部键，因此“清空某个字段”仍可正常生效；
  //   但若收到只含部分键的请求，不会把其余设置误清空。）
  const existing = getSiteSettings();
  const safeValues: Record<string, string> = {};
  for (const key of SETTING_KEYS) {
    if (!(key in values)) {
      safeValues[key] = existing[key] ?? "";
      continue;
    }
    const limit = key === "about_content" ? 20000 : 2000;
    safeValues[key] = String(values[key] ?? "").trim().slice(0, limit);
  }
  setSiteSettings(safeValues);
  revalidatePath("/", "layout");
  revalidatePath("/about");
  return { ok: true };
}

export async function createCategoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name || name.length > 80) return;
  createCategory(name);
  revalidatePath("/admin/categories");
  revalidatePath("/", "layout");
}

export async function deleteCategoryAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id < 1) return;
  deleteCategory(id);
  revalidatePath("/admin/categories");
  revalidatePath("/", "layout");
}
