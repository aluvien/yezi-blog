import { NextResponse } from "next/server";
import type { Comment, Moment, Post, Work } from "@/lib/db";
import { parsePostTags } from "@/lib/post-tags";

const CORS_ORIGIN = process.env.API_CORS_ORIGIN?.trim() || "*";

export const API_VERSION = "v1";

export function apiHeaders(): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": CORS_ORIGIN,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Cache-Control": "no-store",
  });
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
    tags: parsePostTags(post.tags),
    created_at: post.created_at,
    updated_at: post.updated_at,
    ...(commentsCount !== undefined || comments ? { comments_count: commentsCount ?? comments?.length ?? 0 } : {}),
    ...(comments ? { comments: comments.map(publicComment) } : {}),
  };
}

export function publicMoment(moment: Moment, commentsCount: number, comments?: Comment[]) {
  return {
    id: moment.id,
    content: moment.content,
    images: parseImages(moment.images),
    created_at: moment.created_at,
    updated_at: moment.updated_at,
    comments_count: commentsCount,
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

function parseImages(raw: string): string[] {
  try {
    const images = JSON.parse(raw);
    return Array.isArray(images) ? images.filter((image): image is string => typeof image === "string") : [];
  } catch {
    return [];
  }
}
