import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { articleReferenceRowToSnapshot, listRecentArticleReferences } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  if (!await requireAdminApi()) return noCache({ error: "未登录" }, 401);
  const url = new URL(request.url);
  const keyword = url.searchParams.get("q")?.trim() ?? "";
  const references = listRecentArticleReferences(keyword, keyword ? 20 : 5).map(articleReferenceRowToSnapshot);
  return noCache({ references });
}
