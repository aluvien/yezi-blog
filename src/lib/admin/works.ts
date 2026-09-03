import { revalidatePath } from "next/cache";
import { createWork, deleteWork, getWork, setWorkRepositories, updateWork } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";
import type { WorkInput } from "@/lib/actions/works";

/**
 * 作品展示的业务核心。鉴权由调用方（Server Action 或已鉴权 Route Handler）负责。
 */

function sanitizeRepositoryIds(value: unknown): number[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((id): id is number => Number.isInteger(id) && (id as number) > 0).slice(0, 50);
}

function validOptionalUrl(value: string): boolean {
  if (!value.trim()) return true;
  if (value.trim().length > 2_000) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validateWork(data: WorkInput): string | null {
  if (!data || typeof data !== "object" || typeof data.title !== "string" || typeof data.description !== "string" || typeof data.link !== "string" || !(data.cover === null || typeof data.cover === "string")) {
    return "作品数据格式无效";
  }
  const title = String(data.title ?? "").trim();
  if (!title) return "请填写标题";
  if (title.length > 240) return "标题不能超过 240 个字符";
  if (String(data.description ?? "").length > 5_000) return "作品介绍不能超过 5000 个字符";
  if (!validOptionalUrl(String(data.link ?? ""))) return "作品链接必须是有效的 http/https 地址";
  if (data.cover && !validOptionalUrl(data.cover) && !data.cover.startsWith("/uploads/")) return "封面地址无效";
  if (!Number.isFinite(data.sort_order) || Math.abs(data.sort_order) > 1_000_000) return "排序值无效";
  return null;
}

export async function createWorkEntry(data: WorkInput): Promise<ActionResult> {
  const validationError = validateWork(data);
  if (validationError) return { ok: false, error: validationError };
  const work = createWork({
    title: data.title.trim(),
    description: data.description,
    cover: data.cover,
    link: data.link.trim() || null,
    sort_order: Math.trunc(data.sort_order),
  });
  const repoIds = sanitizeRepositoryIds(data.repository_ids);
  if (repoIds) setWorkRepositories(work.id, repoIds);
  revalidatePath("/admin/works");
  revalidatePath("/admin/life");
  revalidatePath("/works");
  revalidatePath("/life");
  revalidatePath("/");
  return { ok: true, data: work };
}

export async function updateWorkEntry(id: number, data: WorkInput): Promise<ActionResult> {
  if (!getWork(id)) return { ok: false, error: "作品不存在" };
  const validationError = validateWork(data);
  if (validationError) return { ok: false, error: validationError };
  const work = updateWork(id, {
    title: data.title.trim(),
    description: data.description,
    cover: data.cover,
    link: data.link.trim() || null,
    sort_order: Math.trunc(data.sort_order),
  });
  const repoIds = sanitizeRepositoryIds(data.repository_ids);
  if (repoIds) setWorkRepositories(id, repoIds);
  revalidatePath("/admin/works");
  revalidatePath("/admin/life");
  revalidatePath("/works");
  revalidatePath("/life");
  revalidatePath("/");
  return { ok: true, data: work };
}

export async function deleteWorkEntry(id: number): Promise<ActionResult> {
  if (!getWork(id)) return { ok: false, error: "作品不存在" };
  deleteWork(id);
  revalidatePath("/admin/works");
  revalidatePath("/admin/life");
  revalidatePath("/works");
  revalidatePath("/life");
  revalidatePath("/");
  return { ok: true, data: { id } };
}
