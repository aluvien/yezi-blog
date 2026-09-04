import { revalidatePath } from "next/cache";
import {
  addReferenceRelation,
  deleteReferenceLibrary,
  deleteReferenceLibraryMany,
  removeReferenceRelation,
  updateReferenceLibraryCollection,
  updateReferenceLibraryMetadata,
  isReferenceTargetType,
} from "@/lib/db";
import type { ReferenceTargetType } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";

/**
 * 引用资料库的业务核心。鉴权由调用方（Server Action 或已鉴权 Route Handler）负责。
 */

function refreshReferencePages(): void {
  revalidatePath("/admin/references");
  revalidatePath("/admin/life");
  revalidatePath("/references");
  revalidatePath("/life");
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

export interface ReferenceCollectionFormInput {
  category?: string;
  tags?: string;
  note?: string;
  status?: string;
  favorite?: boolean;
}

/** 更新收藏资料的分类、标签、备注、状态与收藏标记。未提供的字段保持不变。 */
export async function updateReferenceCollectionEntry(id: number, data: ReferenceCollectionFormInput): Promise<ActionResult> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "引用不存在" };
  if (data.category !== undefined && data.category.length > 80) return { ok: false, error: "分类名称过长" };
  if (data.note !== undefined && data.note.length > 2_000) return { ok: false, error: "备注不能超过 2000 个字符" };
  if (data.status !== undefined && data.status !== "inbox" && data.status !== "read" && data.status !== "archived") {
    return { ok: false, error: "收藏状态无效" };
  }
  const updated = updateReferenceLibraryCollection(id, {
    ...(data.category === undefined ? {} : { category: data.category }),
    ...(data.tags === undefined ? {} : { tags: data.tags }),
    ...(data.note === undefined ? {} : { note: data.note }),
    ...(data.status === undefined ? {} : { status: data.status }),
    ...(data.favorite === undefined ? {} : { favorite: data.favorite }),
  });
  if (!updated) return { ok: false, error: "引用不存在" };
  refreshReferencePages();
  return { ok: true, message: "收藏信息已更新" };
}

/** 建立资料与其他内容（文章/生活节点/作品/仓库）的关联。 */
export async function addReferenceRelationEntry(input: { reference_id: number; target_type: string; target_id: number; context?: string }): Promise<ActionResult> {
  if (!Number.isInteger(input.reference_id) || input.reference_id < 1) return { ok: false, error: "引用不存在" };
  if (!isReferenceTargetType(input.target_type)) return { ok: false, error: "关联类型无效" };
  if (!Number.isInteger(input.target_id) || input.target_id < 1) return { ok: false, error: "关联对象无效" };
  const created = addReferenceRelation({ reference_id: input.reference_id, target_type: input.target_type as ReferenceTargetType, target_id: input.target_id, context: input.context });
  refreshReferencePages();
  return created ? { ok: true, message: "已添加关联" } : { ok: false, error: "关联已存在或引用不存在" };
}

export async function removeReferenceRelationEntry(input: { reference_id: number; target_type: string; target_id: number }): Promise<ActionResult> {
  if (!isReferenceTargetType(input.target_type)) return { ok: false, error: "关联类型无效" };
  const removed = removeReferenceRelation({ reference_id: input.reference_id, target_type: input.target_type as ReferenceTargetType, target_id: input.target_id });
  refreshReferencePages();
  return removed ? { ok: true, message: "已移除关联" } : { ok: false, error: "关联不存在" };
}
