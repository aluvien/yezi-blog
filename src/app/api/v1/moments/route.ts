import { apiJson, apiOptions, paginationMeta, parsePagination, publicMoment } from "@/lib/api";
import { countApprovedCommentsBulk, countMoments, getContentMetricsBulk, listMoments } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const moments = listMoments({ limit, offset: (page - 1) * limit });
  const ids = moments.map((moment) => moment.id);
  // 批量查询，避免 N+1。
  const commentCounts = countApprovedCommentsBulk("moment", ids);
  const metrics = getContentMetricsBulk("moment", ids);
  const emptyMetrics = { views: 0, likes: 0 };
  return apiJson({
    data: moments.map((moment) => publicMoment(moment, commentCounts.get(moment.id) ?? 0, undefined, metrics.get(moment.id) ?? emptyMetrics)),
    meta: paginationMeta(page, limit, countMoments()),
  });
}

export function OPTIONS() {
  return apiOptions();
}
