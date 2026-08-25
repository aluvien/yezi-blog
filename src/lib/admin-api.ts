import { NextResponse } from "next/server";
import { requireAdminApi, requireAdminApiRequest } from "@/lib/auth";
import { requestContentType, validateSameOriginWrite } from "@/lib/request-security";
import type { PostInput } from "@/lib/actions/posts";
import type { Comment, CommentWithTarget, Moment, Post, ReferenceLibraryItem, Session, Work } from "@/lib/db";
import { normalizeArticleReferenceSnapshot, type ArticleReferenceSnapshot } from "@/lib/article-reference";
import { parseMomentImages } from "@/lib/moments";
import { parsePostTags } from "@/lib/post-tags";
import { readLimitedJson, RequestBodyError } from "@/lib/request";

export const ADMIN_API_VERSION = "v1";
export const ADMIN_API_MAX_BODY_BYTES = 2 * 1024 * 1024;
export const ADMIN_API_MAX_PAGE = 1_000_000;
export const ADMIN_API_MAX_LIMIT = 100;

function adminHeaders(): Headers {
  return new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "X-API-Version": ADMIN_API_VERSION,
    "X-Content-Type-Options": "nosniff",
  });
}

export function adminApiJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: adminHeaders() });
}

export function adminSuccess(data: unknown, meta: Record<string, unknown> = {}): NextResponse {
  return adminApiJson({ data, meta });
}

export function adminError(code: string, message: string, status: number): NextResponse {
  return adminApiJson({ error: { code, message } }, status);
}

export type AdminAuthResult =
  | { ok: true; session: Session }
  | { ok: false; response: NextResponse };

/** 所有 /api/admin/v1 路由统一从 admin_session Cookie 读取会话，绝不 redirect 到 HTML 登录页。 */
export async function authorizeAdminApi(request?: Request): Promise<AdminAuthResult> {
  const unsafe = request && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
  const bearer = request?.headers.get("authorization")?.startsWith("Bearer ") ?? false;
  if (unsafe && !bearer) {
    const rejection = validateSameOriginWrite(request, { requireCsrfHeader: true });
    if (rejection) return { ok: false, response: adminError("CSRF_REJECTED", rejection.message, rejection.status) };
    if (requestContentType(request) === "text/plain") {
      return { ok: false, response: adminError("UNSUPPORTED_MEDIA_TYPE", "管理写接口不接受 text/plain", 415) };
    }
  }
  const session = request ? await requireAdminApiRequest(request) : await requireAdminApi();
  if (!session) {
    return {
      ok: false,
      response: adminError("UNAUTHENTICATED", "未登录或登录已过期", 401),
    };
  }
  return { ok: true, session };
}

export type AdminJsonResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; response: NextResponse };

export async function readAdminJson(request: Request, maxBytes = ADMIN_API_MAX_BODY_BYTES): Promise<AdminJsonResult> {
  try {
    const value = await readLimitedJson<unknown>(request, maxBytes);
    if (!isRecord(value)) return { ok: false, response: adminError("INVALID_JSON", "请求体必须是 JSON 对象", 400) };
    return { ok: true, value };
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return {
      ok: false,
      response: adminError(status === 413 ? "PAYLOAD_TOO_LARGE" : "INVALID_JSON", error instanceof Error ? error.message : "请求格式错误", status),
    };
  }
}

/** 部署类端点不接收任何命令、路径、分支或 PM2 参数。允许空 JSON 对象，拒绝其他请求体。 */
export async function requireEmptyAdminJsonBody(request: Request): Promise<NextResponse | null> {
  if (!request.body) return null;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (Object.keys(body.value).length > 0) return adminError("INVALID_PARAMETER", "该接口不接受命令、路径、分支或进程参数", 400);
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function parseAdminId(raw: string): number | null {
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export type AdminPagination = { page: number; limit: number; offset: number };

export function parseAdminPagination(request: Request): AdminPagination | NextResponse {
  const params = new URL(request.url).searchParams;
  const page = parsePositiveQueryNumber(params.get("page"), 1);
  const limit = parsePositiveQueryNumber(params.get("limit"), 20);
  if (page === null || limit === null || page > ADMIN_API_MAX_PAGE || limit > ADMIN_API_MAX_LIMIT) {
    return adminError("INVALID_PAGINATION", `page 必须为 1-${ADMIN_API_MAX_PAGE} 的整数，limit 必须为 1-${ADMIN_API_MAX_LIMIT} 的整数`, 400);
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) return adminError("INVALID_PAGINATION", "分页参数超出允许范围", 400);
  return { page, limit, offset };
}

function parsePositiveQueryNumber(raw: string | null, fallback: number): number | null {
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function paginationMeta(page: number, limit: number, total: number): Record<string, number> {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

export function readQueryText(request: Request, key: string, maxLength: number): string | NextResponse {
  const value = new URL(request.url).searchParams.get(key) ?? "";
  if (value.length > maxLength) return adminError("INVALID_PARAMETER", `${key} 不能超过 ${maxLength} 个字符`, 400);
  return value.trim();
}

export function adminActionError(result: { ok: false; error: string }, code = "VALIDATION_ERROR"): NextResponse {
  const notFound = result.error.includes("不存在");
  return adminError(notFound ? "NOT_FOUND" : code, result.error, notFound ? 404 : 400);
}

export function adminInternalError(scope: string, error: unknown): NextResponse {
  console.error(`[admin-api] ${scope} failed`, error instanceof Error ? error.message : error);
  return adminError("INTERNAL_ERROR", "服务器处理失败，请稍后重试", 500);
}

/** 后台引用库完整字段；归档正文和原始文件路径仍不通过 REST API 暴露。 */
export function serializeAdminReference(reference: ReferenceLibraryItem): Record<string, unknown> {
  return {
    id: reference.id,
    url: reference.url,
    canonical_url: reference.canonical_url,
    title: reference.title,
    source_name: reference.source_name,
    author: reference.author,
    published_at: reference.published_at,
    cover_url: reference.cover,
    description: reference.description,
    summary: reference.summary,
    key_points: parseJsonArray(reference.key_points),
    category: reference.category,
    tags: parsePostTags(reference.tags),
    archive_captured_at: reference.archive_captured_at,
    archive_updated_at: reference.archive_updated_at,
    archive_cache_report: parseJsonValue(reference.archive_cache_report),
    linked_post_count: Number(reference.linked_post_count ?? 0),
    linked_post_titles: reference.linked_post_titles ? reference.linked_post_titles.split(",").filter(Boolean) : [],
    created_at: reference.created_at,
    updated_at: reference.updated_at,
  };
}

function parseJsonArray(value: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(value || "[]") as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function parseJsonValue(value: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function parseAdminReferenceSnapshot(value: unknown): ArticleReferenceSnapshot | null {
  if (!isRecord(value)) return null;
  const snapshot = normalizeArticleReferenceSnapshot(value as Partial<ArticleReferenceSnapshot>);
  return snapshot.url ? snapshot : null;
}

export function serializeAdminPostSummary(post: Post, metrics?: { views: number; likes: number }): Record<string, unknown> {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    cover: post.cover,
    category: post.category,
    tags: parsePostTags(post.tags),
    status: post.status,
    created_at: post.created_at,
    updated_at: post.updated_at,
    ...(metrics ? { metrics } : {}),
  };
}

export function serializeAdminPost(
  post: Post,
  options: { metrics?: { views: number; likes: number }; attachmentIds?: number[]; referenceSnapshots?: unknown[] } = {},
): Record<string, unknown> {
  return {
    ...serializeAdminPostSummary(post, options.metrics),
    content: post.content,
    attachmentIds: options.attachmentIds ?? [],
    referenceSnapshots: options.referenceSnapshots ?? [],
  };
}

export function serializeAdminComment(comment: Comment | CommentWithTarget): Record<string, unknown> {
  const target = comment as CommentWithTarget;
  return {
    id: comment.id,
    target_type: comment.target_type,
    target_id: comment.target_id,
    target_label: target.target_label ?? null,
    target_slug: target.target_slug ?? null,
    nickname: comment.nickname,
    email: comment.email,
    website: comment.website,
    content: comment.content,
    status: comment.status,
    created_at: comment.created_at,
    admin_reply: comment.admin_reply,
    replied_at: comment.replied_at,
  };
}

export function serializeAdminMoment(moment: Moment, metrics?: { views: number; likes: number }): Record<string, unknown> {
  return {
    id: moment.id,
    content: moment.content,
    images: parseMomentImages(moment),
    created_at: moment.created_at,
    updated_at: moment.updated_at,
    ...(metrics ? { metrics } : {}),
  };
}

export function serializeAdminWork(work: Work): Record<string, unknown> {
  return {
    id: work.id,
    title: work.title,
    description: work.description,
    cover: work.cover,
    link: work.link,
    sort_order: work.sort_order,
    created_at: work.created_at,
  };
}

export type AdminPostInputResult =
  | { ok: true; value: PostInput }
  | { ok: false; response: NextResponse };

/** 只做 JSON 字段形状转换；长度、URL、状态等业务校验继续由 posts Action 负责。 */
export function parseAdminPostInput(body: Record<string, unknown>, defaults: Partial<PostInput> = {}): AdminPostInputResult {
  const get = (key: keyof PostInput): unknown => hasOwn(body, key) ? body[key] : defaults[key];
  const tags = parseAdminTags(get("tags"));
  if (tags === null) return { ok: false, response: adminError("INVALID_PARAMETER", "tags 必须是逗号分隔字符串或字符串数组", 400) };
  const references = parseAdminReferences(get("referenceSnapshots"));
  if (references === null) return { ok: false, response: adminError("INVALID_PARAMETER", "referenceSnapshots 必须是对象数组", 400) };
  return {
    ok: true,
    value: {
      title: get("title") as string,
      slug: get("slug") as string,
      content: get("content") as string,
      cover: get("cover") as string | null,
      category: get("category") as string,
      tags: (tags ?? get("tags")) as string,
      attachmentIds: get("attachmentIds") as number[],
      referenceSnapshots: references ?? undefined,
      status: get("status") as "draft" | "published",
    },
  };
}

function parseAdminTags(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value.join(", ");
  return null;
}

function parseAdminReferences(value: unknown): PostInput["referenceSnapshots"] | null | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => !isRecord(item))) return null;
  return value as PostInput["referenceSnapshots"];
}
