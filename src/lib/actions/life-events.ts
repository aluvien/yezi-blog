"use server";

import { requireAdmin } from "@/lib/auth";
import {
  createLifeEventEntry,
  deleteLifeEventEntry,
  extractLifeEventFromMoment,
  updateLifeEventEntry,
  type LifeEventFormInput,
} from "@/lib/admin/life-events";
import type { ActionResult } from "@/lib/actions/posts";

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/life-events。 */

export async function createLifeEventAction(data: LifeEventFormInput): Promise<ActionResult> {
  await requireAdmin();
  return createLifeEventEntry(data);
}

export async function updateLifeEventAction(id: number, data: LifeEventFormInput): Promise<ActionResult> {
  await requireAdmin();
  return updateLifeEventEntry(id, data);
}

export async function deleteLifeEventAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return deleteLifeEventEntry(id);
}

/** 从一条絮语提取生活节点：需用户在整理界面确认后才创建，原絮语保持不变。 */
export async function extractLifeEventFromMomentAction(momentId: number, data: LifeEventFormInput): Promise<ActionResult> {
  await requireAdmin();
  return extractLifeEventFromMoment(momentId, data);
}
