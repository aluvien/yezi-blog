"use server";

import { requireAdmin } from "@/lib/auth";
import {
  addReferenceRelationEntry,
  deleteReference,
  deleteReferenceMany,
  removeReferenceRelationEntry,
  updateReferenceCollectionEntry,
  updateReferenceMetadata,
  type ReferenceCollectionFormInput,
} from "@/lib/admin/references";
import type { ActionResult } from "@/lib/actions/posts";

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/references。 */

/** 更新独立引用的分类和标签，不影响文章正文中的引用快照。 */
export async function updateReferenceLibraryMetadataAction(id: number, formData: FormData): Promise<void> {
  await requireAdmin();
  const category = String(formData.get("category") ?? "").trim();
  const tags = String(formData.get("tags") ?? "");
  await updateReferenceMetadata(id, category, tags);
}

/** 更新收藏资料的分类、标签、备注、状态与收藏标记。 */
export async function updateReferenceCollectionAction(id: number, data: ReferenceCollectionFormInput): Promise<ActionResult> {
  await requireAdmin();
  return updateReferenceCollectionEntry(id, data);
}

export async function addReferenceRelationAction(input: { reference_id: number; target_type: string; target_id: number; context?: string }): Promise<ActionResult> {
  await requireAdmin();
  return addReferenceRelationEntry(input);
}

export async function removeReferenceRelationAction(input: { reference_id: number; target_type: string; target_id: number }): Promise<ActionResult> {
  await requireAdmin();
  return removeReferenceRelationEntry(input);
}

/** 只删除引用资料库记录，不改动已关联文章正文。 */
export async function deleteReferenceLibraryAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return deleteReference(id);
}

/** 批量删除引用资料库记录，不影响已经关联文章中的引用快照。 */
export async function deleteReferenceLibraryManyAction(ids: number[]): Promise<ActionResult> {
  await requireAdmin();
  return deleteReferenceMany(ids);
}
