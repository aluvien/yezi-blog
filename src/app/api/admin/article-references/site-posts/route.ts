import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { searchPublishedPostsForReference } from "@/lib/db";
import { stripMarkdown } from "@/lib/markdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!await requireAdminApi()) {
    return NextResponse.json({ error: "未登录" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const keyword = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const posts = searchPublishedPostsForReference(keyword, 20).map((post) => ({
    slug: post.slug,
    title: post.title,
    summary: stripMarkdown(post.content, 180),
  }));
  return NextResponse.json({ posts }, { headers: { "cache-control": "no-store" } });
}
