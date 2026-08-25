import { apiJson, apiOptions, parsePagination, paginationMeta, publicMoment, publicPost } from "@/lib/api";
import { countApprovedCommentsBulk, countPublicFeedItems, getContentMetricsBulk, listPublicFeedPage } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  if (page > 10_000) return apiJson({ error: "page 超出允许范围" }, 400);
  const total = countPublicFeedItems();
  const selected = listPublicFeedPage(limit, (page - 1) * limit);
  const postIds = selected.flatMap((item) => item.type === "post" ? [item.value.id] : []);
  const momentIds = selected.flatMap((item) => item.type === "moment" ? [item.value.id] : []);
  const postCommentCounts = countApprovedCommentsBulk("post", postIds);
  const momentCommentCounts = countApprovedCommentsBulk("moment", momentIds);
  const postMetrics = getContentMetricsBulk("post", postIds);
  const momentMetrics = getContentMetricsBulk("moment", momentIds);
  const emptyMetrics = { views: 0, likes: 0 };
  const feed = selected.map((entry) => entry.type === "post"
    ? {
        type: "post" as const,
        created_at: entry.created_at,
        item: { ...publicPost(entry.value, undefined, postCommentCounts.get(entry.value.id) ?? 0), metrics: postMetrics.get(entry.value.id) ?? emptyMetrics },
      }
    : {
        type: "moment" as const,
        created_at: entry.created_at,
        item: publicMoment(entry.value, momentCommentCounts.get(entry.value.id) ?? 0, undefined, momentMetrics.get(entry.value.id) ?? emptyMetrics),
      });
  return apiJson({
    data: feed,
    meta: paginationMeta(page, limit, total),
  });
}

export function OPTIONS() {
  return apiOptions();
}
