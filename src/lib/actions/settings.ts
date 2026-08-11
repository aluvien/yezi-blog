"use server";

import { revalidatePath } from "next/cache";
import {
  createCategory,
  deleteCategory,
  deleteTag as deleteTagInDb,
  getSiteSettings,
  renameTag as renameTagInDb,
  setSiteSettings,
  updateCategory,
} from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { refreshQQMusicHealthScheduler } from "@/lib/qq-music-scheduler";

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
  "author_name",
  "author_email",
  "gravatar_mirror",
  "author_avatar",
  "author_avatar_no_border",
  "about_content",
  "default_music",
  "default_music_shuffle",
  "music_float_enabled",
  "music_float_info_enabled",
  "music_position",
  "qq_music_health_check_enabled",
  "qq_music_health_check_interval_hours",
  "telegram_comment_notifications_enabled",
  "theme",
  "layout_theme",
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
    const value = String(values[key] ?? "").trim().slice(0, limit);
    safeValues[key] = key === "music_position" ? (value === "bottom" ? "bottom" : "left") : value;
  }
  const schedulerChanged = ["qq_music_health_check_enabled", "qq_music_health_check_interval_hours"]
    .some((key) => safeValues[key] !== (existing[key] ?? ""));
  setSiteSettings(safeValues);
  if (schedulerChanged) refreshQQMusicHealthScheduler();
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

function revalidateTaxonomy(): void {
  revalidatePath("/admin/categories");
  revalidatePath("/admin/posts");
  revalidatePath("/", "layout");
}

export async function updateCategoryAction(id: number, name: string): Promise<SettingsActionResult> {
  await requireAdmin();
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "分类不存在" };
  const normalized = String(name ?? "").trim();
  if (!normalized || normalized.length > 80) return { ok: false, error: "分类名称不能为空且不超过 80 个字符" };
  const updated = updateCategory(id, normalized);
  if (!updated) return { ok: false, error: "分类不存在，或名称已经被使用" };
  revalidateTaxonomy();
  return { ok: true };
}

export async function deleteCategoryByIdAction(id: number): Promise<SettingsActionResult> {
  await requireAdmin();
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "分类不存在" };
  deleteCategory(id);
  revalidateTaxonomy();
  return { ok: true };
}

function validTagName(value: string): boolean {
  return Boolean(value.trim()) && value.trim().length <= 80 && !/[,，\n]/.test(value);
}

export async function renameTagAction(oldTag: string, newTag: string): Promise<SettingsActionResult> {
  await requireAdmin();
  if (!validTagName(oldTag) || !validTagName(newTag)) return { ok: false, error: "标签不能为空、不能包含逗号，且不超过 80 个字符" };
  if (!renameTagInDb(oldTag, newTag)) return { ok: false, error: "标签修改失败" };
  revalidateTaxonomy();
  return { ok: true };
}

export async function deleteTagAction(tag: string): Promise<SettingsActionResult> {
  await requireAdmin();
  if (!validTagName(tag)) return { ok: false, error: "标签名称无效" };
  if (!deleteTagInDb(tag)) return { ok: false, error: "标签删除失败" };
  revalidateTaxonomy();
  return { ok: true };
}
