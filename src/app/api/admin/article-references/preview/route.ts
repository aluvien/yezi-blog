import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { fetchReferenceDocument } from "@/lib/article-reference-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request) {
  if (!await requireAdminApi()) return noCache({ error: "未登录" }, 401);
  let body: { url?: unknown };
  try {
    body = await request.json();
  } catch {
    return noCache({ error: "请求格式错误" }, 400);
  }

  try {
    const document = await fetchReferenceDocument(String(body.url ?? ""));
    return noCache({ snapshot: document.snapshot });
  } catch (error) {
    return noCache({ error: error instanceof Error ? error.message : "读取文章失败" }, 422);
  }
}
