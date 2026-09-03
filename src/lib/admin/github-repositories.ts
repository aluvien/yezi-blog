// GitHub 仓库登记与元数据同步的业务核心。与 admin/deploy 的服务器代码同步无关：
// 这里只同步仓库展示元数据。鉴权由调用方负责。
import { revalidatePath } from "next/cache";
import {
  applyGithubSyncResult,
  deleteGithubRepository,
  getGithubRepository,
  getGithubRepositoryByFullName,
  listGithubRepositories,
  markGithubSyncError,
  registerGithubRepository,
  updateGithubRepositoryCustom,
} from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";
import { parseGithubRepositoryRef } from "@/lib/github-repository-url";
import { fetchGithubRepositoryMetadata, type GithubSyncError } from "@/lib/github-api";

export interface GithubCustomFormInput {
  custom_title?: string;
  custom_description?: string;
  cover?: string | null;
  tags?: string[];
  featured?: boolean;
}

function revalidateGithubPages(): void {
  revalidatePath("/admin/life/github");
  revalidatePath("/admin/life");
  revalidatePath("/admin");
  revalidatePath("/life");
}

function normalizeCustomInput(data: GithubCustomFormInput): { error: string } | { value: GithubCustomFormInput } {
  const customTitle = String(data.custom_title ?? "").trim();
  if (customTitle.length > 240) return { error: "自定义标题不能超过 240 个字符" };
  const customDescription = String(data.custom_description ?? "").trim();
  if (customDescription.length > 5_000) return { error: "自定义描述不能超过 5000 个字符" };
  const cover = data.cover ?? null;
  if (typeof cover === "string" && cover) {
    const isUpload = cover.startsWith("/uploads/") && !cover.startsWith("//");
    let isHttp = false;
    try { const url = new URL(cover); isHttp = url.protocol === "http:" || url.protocol === "https:"; } catch { isHttp = false; }
    if (!isUpload && !isHttp) return { error: "封面地址无效" };
  }
  return { value: { custom_title: customTitle, custom_description: customDescription, cover, tags: data.tags ?? [], featured: Boolean(data.featured) } };
}

/** 登记仓库；随后尽力同步一次元数据。同步失败不回滚登记，只反映到 sync_status。 */
export async function registerGithubRepositoryEntry(input: string, custom: GithubCustomFormInput = {}): Promise<ActionResult> {
  const ref = parseGithubRepositoryRef(input);
  if (!ref) return { ok: false, error: "请输入有效的 GitHub 仓库，例如 https://github.com/owner/repo 或 owner/repo" };
  if (getGithubRepositoryByFullName(ref.fullName)) return { ok: false, error: "该仓库已经登记过了" };
  const normalized = normalizeCustomInput(custom);
  if ("error" in normalized) return { ok: false, error: normalized.error };
  const repo = registerGithubRepository({
    owner: ref.owner,
    name: ref.name,
    fullName: ref.fullName,
    repoUrl: ref.repoUrl,
    customTitle: normalized.value.custom_title,
    customDescription: normalized.value.custom_description,
    cover: normalized.value.cover,
    tags: normalized.value.tags,
    featured: normalized.value.featured,
  });
  const synced = await syncGithubRepositoryMetadata(repo.id);
  revalidateGithubPages();
  return { ok: true, data: { id: repo.id, sync: synced.ok } };
}

export async function updateGithubRepositoryEntry(id: number, custom: GithubCustomFormInput): Promise<ActionResult> {
  if (!Number.isInteger(id) || id < 1 || !getGithubRepository(id)) return { ok: false, error: "仓库不存在" };
  const normalized = normalizeCustomInput(custom);
  if ("error" in normalized) return { ok: false, error: normalized.error };
  const repo = updateGithubRepositoryCustom(id, normalized.value);
  revalidateGithubPages();
  return { ok: true, data: repo };
}

export async function deleteGithubRepositoryEntry(id: number): Promise<ActionResult> {
  if (!Number.isInteger(id) || id < 1 || !getGithubRepository(id)) return { ok: false, error: "仓库不存在" };
  deleteGithubRepository(id);
  revalidateGithubPages();
  return { ok: true, data: { id } };
}

const ERROR_FALLBACK: Record<GithubSyncError, string> = {
  missing_token: "未配置 GITHUB_TOKEN",
  rate_limited: "已达到 GitHub 速率限制，请稍后再试",
  not_found: "仓库不存在或不可访问",
  unauthorized: "GitHub Token 无效或权限不足",
  network: "无法连接 GitHub",
  invalid: "GitHub 返回的数据无法解析",
};

/** 同步单个仓库元数据。成功写自动字段并置 success；失败只记状态与可读原因，保留上次成功数据。 */
export async function syncGithubRepositoryMetadata(id: number): Promise<ActionResult> {
  const repo = getGithubRepository(id);
  if (!repo) return { ok: false, error: "仓库不存在" };
  const result = await fetchGithubRepositoryMetadata({ owner: repo.owner, name: repo.name, fullName: repo.full_name, repoUrl: repo.repo_url });
  if (!result.ok) {
    const message = ERROR_FALLBACK[result.error] || result.message;
    markGithubSyncError(id, message);
    revalidateGithubPages();
    return { ok: false, error: message };
  }
  applyGithubSyncResult(id, result.metadata);
  revalidateGithubPages();
  return { ok: true, message: "已同步仓库信息", data: { id } };
}

/** 批量同步：单个失败不中止整体，返回成功/失败统计（失败项含可读原因，不含内部栈）。 */
export async function syncAllGithubRepositoryMetadata(): Promise<ActionResult> {
  const repos = listGithubRepositories();
  let succeeded = 0;
  const failures: Array<{ id: number; fullName: string; reason: string }> = [];
  for (const repo of repos) {
    const result = await fetchGithubRepositoryMetadata({ owner: repo.owner, name: repo.name, fullName: repo.full_name, repoUrl: repo.repo_url });
    if (result.ok) {
      applyGithubSyncResult(repo.id, result.metadata);
      succeeded += 1;
    } else {
      const reason = ERROR_FALLBACK[result.error] || result.message;
      markGithubSyncError(repo.id, reason);
      failures.push({ id: repo.id, fullName: repo.full_name, reason });
    }
  }
  revalidateGithubPages();
  return {
    ok: true,
    message: `同步完成：成功 ${succeeded} 个，失败 ${failures.length} 个`,
    data: { total: repos.length, succeeded, failed: failures.length, failures },
  };
}
