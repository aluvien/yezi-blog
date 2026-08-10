import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { listRecentArticleReferences } from "@/lib/db";
import { normalizeArticleReferenceSnapshot } from "@/lib/article-reference";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

function parseKeyPoints(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "")).filter(Boolean).slice(0, 6) : [];
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  if (!await requireAdminApi()) return noCache({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const keyword = url.searchParams.get("q")?.trim() ?? "";
  const references = listRecentArticleReferences(keyword, keyword ? 20 : 5).map((reference) => normalizeArticleReferenceSnapshot({
    url: reference.url,
    canonicalUrl: reference.canonical_url,
    title: reference.title,
    source: reference.source_name,
    author: reference.author,
    publishedAt: reference.published_at,
    cover: reference.cover,
    description: reference.description,
    summary: reference.summary,
    keyPoints: parseKeyPoints(reference.key_points),
  }));
  return noCache({ references });
}
