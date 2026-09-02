import { revalidatePath } from "next/cache";
import { createMoment, deleteMoment, getMoment, updateMoment } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";
import { invalidateQQMusicAccessCache } from "@/lib/qq-music-access";
import { normalizeMediaShortcodes } from "@/lib/media-shortcodes";
import { normalizeMomentLocation } from "@/lib/moment-location";
import { normalizePostTags } from "@/lib/post-tags";

/**
 * 想法（Moment）的业务核心。鉴权由调用方（Server Action 或已鉴权 Route Handler）负责。
 */

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

export async function createMomentEntry(data: { content: string; images: string[]; tags?: string[]; location?: string }): Promise<ActionResult> {
  if (!data || typeof data.content !== "string") return { ok: false, error: "想法数据格式无效" };
  const content = normalizeMediaShortcodes(data.content.trim());
  if (content.length > MAX_MOMENT_CONTENT_LENGTH) return { ok: false, error: "想法内容不能超过 2 万个字符" };
  const images = normalizeMomentImages(data.images);
  if (!images) return { ok: false, error: "图片地址无效或数量超过 9 张" };
  const location = normalizeMomentLocation(data.location);
  if (location === null) return { ok: false, error: "位置格式无效或超过 80 个字符" };
  if (!content && images.length === 0) return { ok: false, error: "写点什么或至少传一张图" };
  const moment = createMoment({ content, images, tags: normalizePostTags(data.tags), location });
  revalidatePath("/admin/moments");
  revalidatePath("/moments");
  revalidatePath("/");
  invalidateQQMusicAccessCache();
  return { ok: true, data: moment };
}

export async function updateMomentEntry(
  id: number,
  data: { content: string; images: string[]; tags?: string[]; location?: string },
): Promise<ActionResult> {
  if (!Number.isInteger(id) || id < 1 || !data || typeof data.content !== "string") return { ok: false, error: "想法数据格式无效" };
  if (!getMoment(id)) return { ok: false, error: "想法不存在" };
  const content = normalizeMediaShortcodes(data.content.trim());
  if (content.length > MAX_MOMENT_CONTENT_LENGTH) return { ok: false, error: "想法内容不能超过 2 万个字符" };
  const images = normalizeMomentImages(data.images);
  if (!images) return { ok: false, error: "图片地址无效或数量超过 9 张" };
  const location = data.location === undefined ? undefined : normalizeMomentLocation(data.location);
  if (location === null) return { ok: false, error: "位置格式无效或超过 80 个字符" };
  if (!content && images.length === 0) return { ok: false, error: "写点什么或至少保留一张图" };
  const tags = data.tags === undefined ? undefined : normalizePostTags(data.tags);
  const moment = updateMoment(id, { content, images, ...(tags === undefined ? {} : { tags }), ...(location === undefined ? {} : { location }) });
  revalidatePath("/admin/moments");
  revalidatePath("/moments");
  revalidatePath("/");
  invalidateQQMusicAccessCache();
  return { ok: true, data: moment };
}

export async function deleteMomentEntry(id: number): Promise<ActionResult> {
  if (!getMoment(id)) return { ok: false, error: "想法不存在" };
  deleteMoment(id);
  revalidatePath("/admin/moments");
  revalidatePath("/moments");
  revalidatePath("/");
  invalidateQQMusicAccessCache();
  return { ok: true, data: { id } };
}
