"use server";

import { requireAdmin } from "@/lib/auth";
import {
  deleteReference,
  deleteReferenceMany,
  updateReferenceMetadata,
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
