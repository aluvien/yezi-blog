"use server";

import { revalidatePath } from "next/cache";
import {
  createCategory,
  deleteCategory,
  deleteTag as deleteTagInDb,
  getSiteSettings,
  listAllTags,
  listCategories,
  renameTag as renameTagInDb,
  setSiteSettings,
  updateCategory,
} from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { refreshQQMusicHealthScheduler } from "@/lib/qq-music-scheduler";
import { invalidateQQMusicAccessCache } from "@/lib/qq-music-access";
import { normalizeMediaShortcodes } from "@/lib/media-shortcodes";

export type SettingsActionResult = { ok: true; data?: unknown } | { ok: false; error: string };

const SETTING_KEYS = [
  "site_name",
  "site_subtitle",
  "site_logo",
  "site_logo_no_border",
  "classic_hero",
  "classic_home_image",
  "classic_home_intro",
  "classic_home_more",
  "classic_home_section_title",
  "classic_sidebar_intro",
  "classic_home_include_bits",
  "classic_show_interactions",
  "classic_show_comments",
  "footer_text",
  "social_links",
  "show_related_posts",
  "show_more_posts",
  "show_table_of_contents",
  "show_home_page",
  "show_moments_page",
  "show_posts_page",
  "show_references_page",
  "show_works_page",
  "show_about_page",
  "author_name",
  "author_email",
  "gravatar_enabled",
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
    if (key === "about_content") {
      safeValues[key] = normalizeMediaShortcodes(value);
      continue;
    }
    safeValues[key] = key === "music_position" ? (value === "bottom" ? "bottom" : "left") : value;
  }
  const schedulerChanged = ["qq_music_health_check_enabled", "qq_music_health_check_interval_hours"]
    .some((key) => safeValues[key] !== (existing[key] ?? ""));
  setSiteSettings(safeValues);
  if (schedulerChanged) refreshQQMusicHealthScheduler();
  if (safeValues.about_content !== (existing.about_content ?? "") || safeValues.default_music !== (existing.default_music ?? "")) {
    invalidateQQMusicAccessCache();
  }
  revalidatePath("/", "layout");
  revalidatePath("/about");
  revalidatePath("/admin/attachments");
  return { ok: true };
}

export async function createCategoryAction(formData: FormData): Promise<void> {
  await createCategoryByNameAction(String(formData.get("name") ?? ""));
}

/** 分类管理网页与原生 API 共用的创建校验。 */
export async function createCategoryByNameAction(name: string): Promise<SettingsActionResult> {
  await requireAdmin();
  const normalized = String(name ?? "").trim();
  if (!normalized || normalized.length > 80) return { ok: false, error: "分类名称不能为空且不超过 80 个字符" };
  if (listCategories().some((category) => category.name.localeCompare(normalized, "zh-CN", { sensitivity: "accent" }) === 0)) {
    return { ok: false, error: "分类名称已经被使用" };
  }
  const created = createCategory(normalized);
  if (!created) return { ok: false, error: "分类创建失败" };
  revalidateTaxonomy();
  return { ok: true, data: created };
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
  if (!listCategories().some((category) => category.id === id)) return { ok: false, error: "分类不存在" };
  if (listCategories().some((category) => category.id !== id && category.name.localeCompare(normalized, "zh-CN", { sensitivity: "accent" }) === 0)) {
    return { ok: false, error: "分类名称已经被使用" };
  }
  const updated = updateCategory(id, normalized);
  if (!updated) return { ok: false, error: "分类更新失败" };
  revalidateTaxonomy();
  return { ok: true, data: updated };
}

export async function deleteCategoryByIdAction(id: number): Promise<SettingsActionResult> {
  await requireAdmin();
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "分类不存在" };
  if (!listCategories().some((category) => category.id === id)) return { ok: false, error: "分类不存在" };
  deleteCategory(id);
  revalidateTaxonomy();
  return { ok: true, data: { id } };
}

function validTagName(value: string): boolean {
  return Boolean(value.trim()) && value.trim().length <= 80 && !/[,，\n]/.test(value);
}

export async function renameTagAction(oldTag: string, newTag: string): Promise<SettingsActionResult> {
  await requireAdmin();
  if (!validTagName(oldTag) || !validTagName(newTag)) return { ok: false, error: "标签不能为空、不能包含逗号，且不超过 80 个字符" };
  if (!listAllTags().some((item) => item.tag.localeCompare(oldTag.trim().replace(/^#+/, ""), "zh-CN", { sensitivity: "accent" }) === 0)) {
    return { ok: false, error: "标签不存在" };
  }
  if (!renameTagInDb(oldTag, newTag)) return { ok: false, error: "标签修改失败" };
  revalidateTaxonomy();
  return { ok: true };
}

export async function deleteTagAction(tag: string): Promise<SettingsActionResult> {
  await requireAdmin();
  if (!validTagName(tag)) return { ok: false, error: "标签名称无效" };
  if (!listAllTags().some((item) => item.tag.localeCompare(tag.trim().replace(/^#+/, ""), "zh-CN", { sensitivity: "accent" }) === 0)) {
    return { ok: false, error: "标签不存在" };
  }
  if (!deleteTagInDb(tag)) return { ok: false, error: "标签删除失败" };
  revalidateTaxonomy();
  return { ok: true };
}
