"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { deleteReferenceLibrary, deleteReferenceLibraryMany, updateReferenceLibraryMetadata } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";

function refreshReferencePages(): void {
  revalidatePath("/admin/references");
  revalidatePath("/references");
  revalidatePath("/admin");
}

/** 更新独立引用的分类和标签，不影响文章正文中的引用快照。 */
export async function updateReferenceLibraryMetadataAction(id: number, formData: FormData): Promise<void> {
  await requireAdmin();
  const category = String(formData.get("category") ?? "").trim();
  const tags = String(formData.get("tags") ?? "");
  if (category.length > 80) return;
  if (!updateReferenceLibraryMetadata(id, category, tags)) return;
  refreshReferencePages();
}

/** 只删除引用资料库记录，不改动已关联文章正文。 */
export async function deleteReferenceLibraryAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "引用不存在" };
  if (!deleteReferenceLibrary(id)) return { ok: false, error: "引用不存在或已被删除" };
  refreshReferencePages();
  return { ok: true, message: "引用已从资料库删除" };
}

/** 批量删除引用资料库记录，不影响已经关联文章中的引用快照。 */
export async function deleteReferenceLibraryManyAction(ids: number[]): Promise<ActionResult> {
  await requireAdmin();
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    return { ok: false, error: "请选择有效的引用" };
  }
  const deleted = deleteReferenceLibraryMany(ids);
  if (deleted === 0) return { ok: false, error: "选中的引用不存在或已被删除" };
  refreshReferencePages();
  return { ok: true, message: `已删除 ${deleted} 条引用` };
}
