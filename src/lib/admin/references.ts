import { revalidatePath } from "next/cache";
import { deleteReferenceLibrary, deleteReferenceLibraryMany, updateReferenceLibraryMetadata } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";

/**
 * 引用资料库的业务核心。鉴权由调用方（Server Action 或已鉴权 Route Handler）负责。
 */

function refreshReferencePages(): void {
  revalidatePath("/admin/references");
  revalidatePath("/references");
  revalidatePath("/admin");
}

/** 更新独立引用的分类和标签，不影响文章正文中的引用快照。 */
export async function updateReferenceMetadata(id: number, category: string, tags: string): Promise<ActionResult> {
  const normalizedCategory = String(category ?? "").trim();
  if (!Number.isInteger(id) || id < 1 || normalizedCategory.length > 80) {
    return { ok: false, error: "引用不存在或分类名称过长" };
  }
  if (!updateReferenceLibraryMetadata(id, normalizedCategory, tags)) return { ok: false, error: "引用不存在" };
  refreshReferencePages();
  return { ok: true, message: "引用信息已更新" };
}

/** 只删除引用资料库记录，不改动已关联文章正文。 */
export async function deleteReference(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "引用不存在" };
  if (!deleteReferenceLibrary(id)) return { ok: false, error: "引用不存在或已被删除" };
  refreshReferencePages();
  return { ok: true, message: "引用已从资料库删除" };
}

/** 批量删除引用资料库记录，不影响已经关联文章中的引用快照。 */
export async function deleteReferenceMany(ids: number[]): Promise<ActionResult> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    return { ok: false, error: "请选择有效的引用" };
  }
  const deleted = deleteReferenceLibraryMany(ids);
  if (deleted === 0) return { ok: false, error: "选中的引用不存在或已被删除" };
  refreshReferencePages();
  return { ok: true, message: `已删除 ${deleted} 条引用`, data: { deletedCount: deleted } };
}
