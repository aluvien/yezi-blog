"use server";

import { requireAdmin } from "@/lib/auth";
import {
  createMomentEntry,
  deleteMomentEntry,
  updateMomentEntry,
} from "@/lib/admin/moments";
import type { ActionResult } from "@/lib/actions/posts";

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/moments。 */

export async function createMomentAction(data: { content: string; images: string[]; tags?: string[]; location?: string }): Promise<ActionResult> {
  await requireAdmin();
  return createMomentEntry(data);
}

export async function updateMomentAction(
  id: number,
  data: { content: string; images: string[]; tags?: string[]; location?: string },
): Promise<ActionResult> {
  await requireAdmin();
  return updateMomentEntry(id, data);
}

export async function deleteMomentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return deleteMomentEntry(id);
}
