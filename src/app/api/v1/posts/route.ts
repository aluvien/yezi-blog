import { apiJson, apiOptions, paginationMeta, parseCollectionFilter, parsePagination, publicPost, publicPostSummary } from "@/lib/api";
import { countApprovedCommentsBulk, countPublishedPosts, getContentMetricsBulk, listPosts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { page, limit } = parsePagination(params);
  const category = parseCollectionFilter(params, "category");
  const tag = parseCollectionFilter(params, "tag");
  const summary = params.get("view") === "summary";
  const filters = { category: category || undefined, tag: tag || undefined };
  const posts = listPosts({ ...filters, limit, offset: (page - 1) * limit });
  const ids = posts.map((post) => post.id);
  // 批量查询，避免每个 post 各查一次评论数/统计（N+1）。
  const commentCounts = countApprovedCommentsBulk("post", ids);
  const metrics = getContentMetricsBulk("post", ids);
  const emptyMetrics = { views: 0, likes: 0 };
  return apiJson({
    data: posts.map((post) => {
      const commentsCount = commentCounts.get(post.id) ?? 0;
      return {
        ...(summary ? publicPostSummary(post, commentsCount) : publicPost(post, undefined, commentsCount)),
        metrics: metrics.get(post.id) ?? emptyMetrics,
      };
    }),
    meta: paginationMeta(page, limit, countPublishedPosts(filters)),
  });
}

export function OPTIONS() {
  return apiOptions();
}
