import { apiJson, apiOptions, paginationMeta, parsePagination, publicMoment, publicPost } from "@/lib/api";
import { countApprovedCommentsBulk, getContentMetricsBulk, searchMoments, searchPosts } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  if (!query) return apiJson({ data: [], meta: paginationMeta(1, 20, 0), query: "" });

  // 全文搜索走 FTS5 索引（trigram 子串匹配）。与旧版内存过滤相比，搜索词现在也会
  // 匹配文章分类（postMatchesSearch 语义），属于小幅行为增强。
  const posts = searchPosts(query);
  const moments = searchMoments(query);
  const postIds = posts.map((post) => post.id);
  const momentIds = moments.map((moment) => moment.id);
  const postCommentCounts = countApprovedCommentsBulk("post", postIds);
  const momentCommentCounts = countApprovedCommentsBulk("moment", momentIds);
  const postMetrics = getContentMetricsBulk("post", postIds);
  const momentMetrics = getContentMetricsBulk("moment", momentIds);
  const emptyMetrics = { views: 0, likes: 0 };
  const results = [
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
  const { page, limit } = parsePagination(params);
  const start = (page - 1) * limit;
  return apiJson({ data: results.slice(start, start + limit), meta: paginationMeta(page, limit, results.length), query });
}

export function OPTIONS() {
  return apiOptions();
}
