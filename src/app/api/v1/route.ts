import { apiJson, apiOptions, API_VERSION } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return apiJson({
    name: "yezi blog API",
    version: API_VERSION,
    endpoints: {
      posts: "/api/v1/posts",
      post: "/api/v1/posts/:slug",
      moments: "/api/v1/moments",
      works: "/api/v1/works",
      comments: "/api/v1/comments",
      feed: "/api/v1/feed",
      interactions: "/api/v1/interactions",
      categories: "/api/v1/categories",
      search: "/api/v1/search?q=关键词",
    },
    pagination: "GET collection endpoints accept page and limit (1-50)",
  });
}

export function OPTIONS() {
  return apiOptions();
}
