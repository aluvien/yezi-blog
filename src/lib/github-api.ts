// GitHub 仓库元数据同步。与服务器部署用的 admin/deploy 完全无关：
// 这里只读取仓库的公开元信息（星标、语言、更新时间等）写入本地缓存。
// 安全约束：绝不把 GITHUB_TOKEN 返回前端或写进日志；失败只暴露可理解的原因。
import { githubRepositoryApiUrl, type GithubRepositoryRef } from "./github-repository-url";

export interface GithubRepositoryMetadata {
  description: string;
  homepage: string;
  primary_language: string;
  topics: string[];
  stars: number;
  forks: number;
  license: string;
  default_branch: string;
  archived: number;
  visibility: string;
  github_created_at: string;
  github_updated_at: string;
  pushed_at: string;
}

export type GithubSyncError = "missing_token" | "rate_limited" | "not_found" | "unauthorized" | "network" | "invalid";

export type GithubSyncResult =
  | { ok: true; metadata: GithubRepositoryMetadata }
  | { ok: false; error: GithubSyncError; message: string };

const MAX_TEXT = 500;
// 控制字符清洗：与 article-reference 的 text() 同义，但用 RegExp 构造避免源码里出现裸控制符。
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

function text(value: unknown): string {
  return String(value ?? "").replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => text(item)).filter(Boolean).slice(0, 20);
}

/** 纯映射：把 GitHub API 的仓库对象收敛成本地字段，便于单测且不触碰网络。 */
export function normalizeGithubMetadata(json: unknown): GithubRepositoryMetadata | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const repo = json as Record<string, unknown>;
  if (typeof repo.full_name !== "string" && typeof repo.name !== "string") return null;
  const license = repo.license && typeof repo.license === "object"
    ? text((repo.license as Record<string, unknown>).spdx_id) || text((repo.license as Record<string, unknown>).name)
    : "";
  const privateRepo = repo.private === true;
  return {
    description: text(repo.description),
    homepage: text(repo.homepage),
    primary_language: text(repo.language),
    topics: stringList(repo.topics),
    stars: count(repo.stargazers_count),
    forks: count(repo.forks_count),
    license: license === "NOASSERTION" ? "" : license,
    default_branch: text(repo.default_branch),
    archived: repo.archived === true ? 1 : 0,
    visibility: text(repo.visibility) || (privateRepo ? "private" : "public"),
    github_created_at: text(repo.created_at),
    github_updated_at: text(repo.updated_at),
    pushed_at: text(repo.pushed_at),
  };
}

export function githubTokenConfigured(): boolean {
  return Boolean(process.env.GITHUB_TOKEN?.trim());
}

interface FetchResponseLike {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
}

async function readErrorDetail(response: FetchResponseLike): Promise<string> {
  try {
    const body = await response.json() as { message?: unknown };
    return text(body?.message).slice(0, 200);
  } catch {
    return "";
  }
}

/**
 * 拉取单个仓库的元数据。没有 Token 时按 GitHub 未认证限流(60/小时)工作并在超限时明确报错。
 * 只请求固定主机 api.github.com 下由 owner/name 拼出的路径，不接受任意目标地址。
 */
export async function fetchGithubRepositoryMetadata(ref: GithubRepositoryRef, fetchImpl: typeof fetch = fetch): Promise<GithubSyncResult> {
  const token = process.env.GITHUB_TOKEN?.trim();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "yezi-blog",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: FetchResponseLike;
  try {
    response = await fetchImpl(githubRepositoryApiUrl(ref), { headers, cache: "no-store", redirect: "error" });
  } catch {
    return { ok: false, error: "network", message: "无法连接 GitHub，请检查网络或稍后重试" };
  }

  if (response.status === 404) return { ok: false, error: "not_found", message: "仓库不存在或不可访问" };
  if (response.status === 401) return { ok: false, error: "unauthorized", message: "GitHub Token 无效或已过期" };
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    if (remaining === "0") {
      return { ok: false, error: "rate_limited", message: token ? "已达到 GitHub API 速率限制" : "未认证访问已达 GitHub 速率限制，请配置 GITHUB_TOKEN 后重试" };
    }
    return { ok: false, error: token ? "rate_limited" : "unauthorized", message: await readErrorDetail(response) || "GitHub 拒绝了本次请求" };
  }
  if (!response.ok) {
    const detail = await readErrorDetail(response);
    return { ok: false, error: "invalid", message: detail || `GitHub 返回错误（${response.status}）` };
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, error: "invalid", message: "GitHub 响应格式异常" };
  }
  const metadata = normalizeGithubMetadata(json);
  if (!metadata) return { ok: false, error: "invalid", message: "无法解析仓库信息" };
  return { ok: true, metadata };
}
