import { apiJson, apiOptions, paginationMeta, parseCollectionFilter, parsePagination, publicPost, publicPostSummary } from "@/lib/api";
import { countApprovedCommentsBulk, countPublishedPosts, getContentMetricsBulk, listPostSummaries, listPosts } from "@/lib/db";
import { getClientIp, hashIp } from "@/lib/request";
import { createSlidingWindowLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 完整正文模式单条最大 150 万字符；把整页条数压到 10，最坏响应约 15 MB，
// 不再允许 50 × 1.5 MB 的 75 MB 级别响应。摘要模式仍可用 50 条大分页。
const FULL_CONTENT_MAX_LIMIT = 10;
const allowPostsRequest = createSlidingWindowLimiter({ windowMs: 60_000, maxRequests: 60, maxKeys: 5_000 });

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const summary = params.get("view") === "summary";
  const { page, limit } = parsePagination(params, summary ? 50 : FULL_CONTENT_MAX_LIMIT);
  if (!allowPostsRequest(hashIp(getClientIp(request)))) {
    return apiJson({ error: "文章列表请求过于频繁，请稍后再试" }, 429);
  }
  const category = parseCollectionFilter(params, "category");
  const tag = parseCollectionFilter(params, "tag");
  const filters = { category: category || undefined, tag: tag || undefined };
  // 摘要模式在 SQL 层就截断正文，不把完整 content 读进进程。
  const posts = summary
    ? listPostSummaries({ ...filters, limit, offset: (page - 1) * limit })
    : listPosts({ ...filters, limit, offset: (page - 1) * limit });
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
