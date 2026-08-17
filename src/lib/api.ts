import { NextResponse } from "next/server";
import type { Comment, Moment, Post, ReferenceLibraryItem, Work } from "@/lib/db";
import { articleReferenceCoverSrc, type ArticleReferenceSnapshot } from "@/lib/article-reference";
import { stripMarkdown } from "@/lib/markdown";
import { parsePostTags } from "@/lib/post-tags";

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

export function apiJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: apiHeaders() });
}

export function apiOptions(): Response {
  return new Response(null, { status: 204, headers: apiHeaders() });
}

export function parsePagination(searchParams: URLSearchParams): { page: number; limit: number } {
  const pageValue = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limitValue = Number.parseInt(searchParams.get("limit") ?? "20", 10);
  return {
    page: Number.isFinite(pageValue) && pageValue > 0 ? pageValue : 1,
    limit: Number.isFinite(limitValue) ? Math.min(50, Math.max(1, limitValue)) : 20,
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
    created_at: reference.created_at,
    updated_at: reference.updated_at,
  };
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
