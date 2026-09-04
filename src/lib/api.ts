import { NextResponse } from "next/server";
import type { Comment, GithubRepository, LifeEvent, LifeFeedItem, Moment, Post, ReferenceLibraryItem, Work } from "@/lib/db";
import { articleReferenceCoverSrc, type ArticleReferenceSnapshot } from "@/lib/article-reference";
import { stripMarkdown } from "@/lib/markdown";
import { parsePostTags } from "@/lib/post-tags";
import { formatLifeEventDate, normalizeLifeDatePrecision } from "@/lib/life-events";

// 默认不发送跨域响应头，避免公开评论接口被任意站点调用。
// 需要 App 跨域访问时，显式设置 API_CORS_ORIGIN 为一个可信来源。
const CORS_ORIGIN = process.env.API_CORS_ORIGIN?.trim() || "";

export const API_VERSION = "v1";

export function apiHeaders(): Headers {
  const headers = new Headers({ "Cache-Control": "no-store", "X-API-Version": API_VERSION });
  if (CORS_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", CORS_ORIGIN);
    headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Yezi-Visitor-Id");
    headers.set("Vary", "Origin");
  }
  return headers;
}

/**
 * cache:"short" 只允许用于公共、只读、不含实时计数（views/likes/评论数）的
 * 参考数据接口：短浏览器缓存 + 共享缓存（CDN）命中，过期后回源。
 * 默认仍是 no-store；错误响应永远不缓存。
 */
const PUBLIC_SHORT_CACHE = "public, max-age=15, s-maxage=60, stale-while-revalidate=600";

export function apiJson(data: unknown, status = 200, options: { cache?: "short" } = {}): NextResponse {
  const headers = apiHeaders();
  if (status === 200 && options.cache === "short") headers.set("Cache-Control", PUBLIC_SHORT_CACHE);
  return NextResponse.json(data, { status, headers });
}

export function apiOptions(): Response {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

export function parsePagination(searchParams: URLSearchParams, maxLimit = 50): { page: number; limit: number } {
  const pageValue = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limitValue = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  return {
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    limit: Number.isFinite(limitValue) ? Math.min(maxLimit, Math.max(1, limitValue)) : 20,
  };
}

/**
 * Collection filters intentionally accept only bounded, displayable text. SQL
 * statements still use placeholders; this bound keeps a public endpoint from
 * doing needless work on an arbitrarily long URL query string.
 */
export function parseCollectionFilter(searchParams: URLSearchParams, key: string, maxLength = 80): string {
  return (searchParams.get(key) ?? "").trim().slice(0, maxLength);
}

export function paginationMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    total_pages: Math.ceil(total / limit),
  };
}

export function publicComment(comment: Comment) {
  return {
    id: comment.id,
    nickname: comment.nickname,
    content: comment.content,
    created_at: comment.created_at,
    admin_reply: comment.admin_reply,
    replied_at: comment.replied_at,
  };
}

export function publicPost(post: Post, comments?: Comment[], commentsCount?: number) {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    content: post.content,
    cover: post.cover,
    category: post.category,
    tags: parsePostTags(post.tags),
    created_at: post.created_at,
    updated_at: post.updated_at,
    ...(commentsCount !== undefined || comments ? { comments_count: commentsCount ?? comments?.length ?? 0 } : {}),
    ...(comments ? { comments: comments.map(publicComment) } : {}),
  };
}

/**
 * Native feeds only need metadata and a short plain-text excerpt. The legacy
 * API default continues to return `publicPost`; callers must opt into this
 * smaller representation with `view=summary`.
 */
export function publicPostSummary(post: Post, commentsCount: number) {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: stripMarkdown(post.content, 180),
    cover: post.cover,
    category: post.category,
    tags: parsePostTags(post.tags),
    created_at: post.created_at,
    updated_at: post.updated_at,
    comments_count: commentsCount,
  };
}

export function publicMoment(moment: Moment, commentsCount: number, comments?: Comment[], metrics?: { views: number; likes: number }) {
  return {
    id: moment.id,
    content: moment.content,
    images: parseImages(moment.images),
    tags: parsePostTags(moment.tags),
    location: moment.location,
    created_at: moment.created_at,
    updated_at: moment.updated_at,
    comments_count: commentsCount,
    ...(metrics ? { metrics } : {}),
    ...(comments ? { comments: comments.map(publicComment) } : {}),
  };
}

export function publicWork(work: Work) {
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

function parseReferenceKeyPoints(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  } catch {
    // A legacy malformed value must not make a public collection unavailable.
    return [];
  }
}

/**
 * The reference reader archive is deliberately admin-only. This serializer is
 * the narrow public contract used by the website's reference cards and native
 * clients, so it never exposes archive, linked-post, or task fields.
 */
export function publicReference(reference: ReferenceLibraryItem) {
  return {
    id: reference.id,
    url: reference.url,
    canonical_url: reference.canonical_url,
    title: reference.title,
    source_name: reference.source_name,
    author: reference.author,
    published_at: reference.published_at,
    cover_url: reference.cover ? articleReferenceCoverSrc(reference.cover, reference.url) : null,
    description: reference.description,
    summary: reference.summary,
    key_points: parseReferenceKeyPoints(reference.key_points),
    category: reference.category,
    tags: parsePostTags(reference.tags),
    note: reference.note,
    status: reference.status,
    favorite: reference.favorite === 1,
    saved_at: reference.saved_at ?? reference.created_at,
    created_at: reference.created_at,
    updated_at: reference.updated_at,
  };
}

/**
 * 生活节点：整理后的时间索引。occurred_at 按 date_precision 展示，
 * 另附 formatLifeEventDate 的显示值，方便原生端直接渲染年份/年月/日。
 */
export function publicLifeEvent(event: LifeEvent) {
  return {
    id: event.id,
    title: event.title,
    content: event.content,
    occurred_at: event.occurred_at,
    date_precision: event.date_precision,
    occurred_display: formatLifeEventDate(event.occurred_at, normalizeLifeDatePrecision(event.date_precision)),
    cover: event.cover,
    images: parseImages(event.images),
    tags: parsePostTags(event.tags),
    location: event.location,
    source_type: event.source_type,
    source_moment_id: event.source_moment_id,
    created_at: event.created_at,
    updated_at: event.updated_at,
  };
}

/**
 * GitHub 仓库：自定义展示字段优先，附带安全的同步元数据。
 * 绝不暴露 sync_error / sync_status 等内部诊断信息。
 */
export function publicGithubRepository(repository: GithubRepository) {
  return {
    id: repository.id,
    owner: repository.owner,
    name: repository.name,
    full_name: repository.full_name,
    repo_url: repository.repo_url,
    display_title: repository.custom_title.trim() || repository.name,
    display_description: repository.custom_description.trim() || repository.description,
    description: repository.description,
    homepage: repository.homepage,
    primary_language: repository.primary_language,
    topics: parseImages(repository.topics),
    stars: repository.stars,
    forks: repository.forks,
    license: repository.license,
    default_branch: repository.default_branch,
    archived: repository.archived === 1,
    visibility: repository.visibility,
    cover: repository.cover,
    tags: parsePostTags(repository.tags),
    featured: repository.featured === 1,
    github_created_at: repository.github_created_at,
    github_updated_at: repository.github_updated_at,
    pushed_at: repository.pushed_at,
    registered_at: repository.registered_at,
  };
}

/** 小记统一时间流的一项：带类型判别的轻量信封 + 对应实体的公开表示。 */
export function publicLifeFeedItem(item: LifeFeedItem) {
  const base = { type: item.type, id: item.id, sort_time: item.sort_time };
  if (item.type === "life_event") return { ...base, life_event: publicLifeEvent(item.value) };
  if (item.type === "work") return { ...base, work: publicWork(item.value) };
  if (item.type === "github_repository") return { ...base, github_repository: publicGithubRepository(item.value) };
  return { ...base, reference: publicReference(item.value) };
}

/** Public Markdown reference metadata, enriched with the same safe cover URL used by web cards. */
export function publicArticleReferenceSnapshot(reference: ArticleReferenceSnapshot) {
  return {
    ...reference,
    cover_url: reference.cover ? articleReferenceCoverSrc(reference.cover, reference.url) : null,
  };
}

function parseImages(raw: string): string[] {
  try {
    const images = JSON.parse(raw);
    return Array.isArray(images) ? images.filter((image): image is string => typeof image === "string") : [];
  } catch {
    return [];
  }
}
