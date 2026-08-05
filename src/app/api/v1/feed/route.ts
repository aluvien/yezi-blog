import { apiJson, apiOptions, parsePagination, paginationMeta, publicMoment, publicPost } from "@/lib/api";
import { countApprovedCommentsBulk, getContentMetricsBulk, listMoments, listPosts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const posts = listPosts();
  const moments = listMoments();
  // 文章与想法按时间合并的流式接口：跨类型排序需在内存合并后分页
  // （纯 SQL UNION 会多一次组装，对个人博客数据量不划算），故保留全量取出 +
  // 内存 slice；评论数与统计改用批量查询，避免每条单独查的 N+1。
  const postIds = posts.map((post) => post.id);
  const momentIds = moments.map((moment) => moment.id);
  const postCommentCounts = countApprovedCommentsBulk("post", postIds);
  const momentCommentCounts = countApprovedCommentsBulk("moment", momentIds);
  const postMetrics = getContentMetricsBulk("post", postIds);
  const momentMetrics = getContentMetricsBulk("moment", momentIds);
  const emptyMetrics = { views: 0, likes: 0 };
  const feed = [
    ...posts.map((post) => ({
      type: "post" as const,
      created_at: post.created_at,
      item: { ...publicPost(post, undefined, postCommentCounts.get(post.id) ?? 0), metrics: postMetrics.get(post.id) ?? emptyMetrics },
    })),
    ...moments.map((moment) => ({
      type: "moment" as const,
      created_at: moment.created_at,
      item: publicMoment(moment, momentCommentCounts.get(moment.id) ?? 0, undefined, momentMetrics.get(moment.id) ?? emptyMetrics),
    })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const start = (page - 1) * limit;
  return apiJson({
    data: feed.slice(start, start + limit),
    meta: paginationMeta(page, limit, feed.length),
  });
}

export function OPTIONS() {
  return apiOptions();
}
