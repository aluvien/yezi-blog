import { after } from "next/server";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { createArticleReferenceArchiveJob, getArticleReferenceArchiveJob, runArticleReferenceArchiveJob } from "@/lib/article-reference-archive-jobs";
import { readLimitedJson, RequestBodyError } from "@/lib/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// AI 筛选最长允许 180 秒；为抓取和图片落盘预留余量。
export const maxDuration = 240;

function noCache(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(request: Request) {
  if (!await requireAdminApi(request)) return noCache({ error: "未登录或请求来源无效" }, 401);
  let body: { url?: unknown; cacheImages?: unknown };
  try {
    body = await readLimitedJson(request, 8 * 1024);
  } catch (error) {
    return noCache({ error: error instanceof Error ? error.message : "请求格式错误" }, error instanceof RequestBodyError ? error.status : 400);
  }

  try {
    const { job, reused } = createArticleReferenceArchiveJob(String(body.url ?? ""));
    if (!reused) after(() => runArticleReferenceArchiveJob(job.id));
    return noCache({ job: { id: job.id, state: job.state }, reused }, 202);
  } catch (error) {
    return noCache({ error: error instanceof Error ? error.message : "缓存阅读正文失败" }, 422);
  }
}

export async function GET(request: Request) {
  if (!await requireAdminApi(request)) return noCache({ error: "未登录" }, 401);
  const jobId = new URL(request.url).searchParams.get("job");
  if (!jobId || !/^[0-9a-f-]{36}$/i.test(jobId)) return noCache({ error: "归档任务不存在" }, 404);
  const job = getArticleReferenceArchiveJob(jobId);
  if (!job) return noCache({ error: "归档任务已失效，请重新开始" }, 404);
  const result = job.result;
  return noCache({
    job: {
      id: job.id,
      state: job.state,
      error: job.error || "",
      archive: result ? {
        canonicalUrl: result.archive.canonical_url,
        title: result.archive.title,
        capturedAt: result.archive.captured_at,
        updatedAt: result.archive.updated_at,
      } : undefined,
      created: result?.created,
      unchanged: result?.unchanged,
      cachedImages: result?.cachedImages,
      report: result?.report,
      ai: result ? { applied: result.aiApplied, summaryGenerated: result.summaryGenerated, error: result.aiError || "" } : undefined,
    },
  });
}
