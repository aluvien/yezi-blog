import { apiJson, apiOptions, paginationMeta, parsePagination, publicMoment, publicPost } from "@/lib/api";
import { countApprovedCommentsBulk, getContentMetricsBulk, listMoments, listPosts } from "@/lib/db";
import { parsePostTags } from "@/lib/post-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function matches(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().slice(0, 100);
  if (!query) return apiJson({ data: [], meta: paginationMeta(1, 20, 0), query: "" });

  // 搜索需先全文过滤再分页，保留内存过滤（FTS 重构见 lib/db.ts 标注）；
  // 评论数与统计改用批量查询，避免每条单独查的 N+1。
  const posts = listPosts().filter((post) => matches(post.title, query) || matches(post.content, query) || parsePostTags(post.tags).some((tag) => matches(tag, query)));
  const moments = listMoments().filter((moment) => matches(moment.content, query));
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
