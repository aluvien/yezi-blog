import { after, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { createArticleReferenceArchiveJob, runArticleReferenceArchiveJob } from "@/lib/article-reference-archive-jobs";
import { fetchReferenceDocument } from "@/lib/article-reference-server";
import { readLimitedJson, RequestBodyError } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 240;

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}
export async function POST(request: Request) {
  if (!await requireAdminApi()) return noCache({ error: "未登录" }, 401);
  let body: { url?: unknown; cacheReader?: unknown; cacheImages?: unknown };
  try {
    body = await readLimitedJson(request, 8 * 1024);
  } catch (error) {
    return noCache({ error: error instanceof Error ? error.message : "请求格式错误" }, error instanceof RequestBodyError ? error.status : 400);
  }

  try {
    const document = await fetchReferenceDocument(String(body.url ?? ""));
    if (body.cacheReader !== false) {
      const { job, reused } = createArticleReferenceArchiveJob(document.snapshot.url);
      if (!reused) after(() => runArticleReferenceArchiveJob(job.id));
      return noCache({
        snapshot: document.snapshot,
        archive: { cached: false, jobStarted: true, reused },
      }, 202);
    }
    return noCache({ snapshot: document.snapshot });
  } catch (error) {
    return noCache({ error: error instanceof Error ? error.message : "读取文章失败" }, 422);
  }
}
