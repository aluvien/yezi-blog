import { countApprovedComments, listPosts } from "@/lib/db";
import { apiJson, apiOptions, paginationMeta, parsePagination, publicPost } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const posts = listPosts();
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const start = (page - 1) * limit;
  return apiJson({
    data: posts
      .slice(start, start + limit)
      .map((post) => publicPost(post, undefined, countApprovedComments("post", post.id))),
    meta: paginationMeta(page, limit, posts.length),
  });
}

export function OPTIONS() {
  return apiOptions();
}
