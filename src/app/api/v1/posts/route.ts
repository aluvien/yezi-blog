import { apiJson, apiOptions, paginationMeta, parsePagination, publicPost } from "@/lib/api";
import { countApprovedCommentsBulk, countPublishedPosts, getContentMetricsBulk, listPosts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const posts = listPosts({ limit, offset: (page - 1) * limit });
  const ids = posts.map((post) => post.id);
  // 批量查询，避免每个 post 各查一次评论数/统计（N+1）。
  const commentCounts = countApprovedCommentsBulk("post", ids);
  const metrics = getContentMetricsBulk("post", ids);
  const emptyMetrics = { views: 0, likes: 0 };
  return apiJson({
    data: posts.map((post) => ({
      ...publicPost(post, undefined, commentCounts.get(post.id) ?? 0),
      metrics: metrics.get(post.id) ?? emptyMetrics,
    })),
    meta: paginationMeta(page, limit, countPublishedPosts()),
  });
}

export function OPTIONS() {
  return apiOptions();
}
