"use server";

import { requireAdmin } from "@/lib/auth";
import {
  createWorkEntry,
  deleteWorkEntry,
  updateWorkEntry,
} from "@/lib/admin/works";
import type { ActionResult } from "@/lib/actions/posts";

export interface WorkInput {
  title: string;
  description: string;
  cover: string | null;
  link: string;
  sort_order: number;
  /** 关联的 GitHub 仓库 id 列表；不传则保持既有关联不变。 */
  repository_ids?: number[];
}

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/works。 */

export async function createWorkAction(data: WorkInput): Promise<ActionResult> {
  await requireAdmin();
  return createWorkEntry(data);
}

export async function updateWorkAction(id: number, data: WorkInput): Promise<ActionResult> {
  await requireAdmin();
  return updateWorkEntry(id, data);
}

export async function deleteWorkAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return deleteWorkEntry(id);
}
