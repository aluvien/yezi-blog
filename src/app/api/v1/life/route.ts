import { apiJson, apiOptions, parsePagination, publicLifeFeedItem } from "@/lib/api";
import { getLifeFeedPage } from "@/lib/life";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { page, limit } = parsePagination(new URL(request.url).searchParams, 30);
  const feed = getLifeFeedPage({ page: String(page), limit: String(limit) });
  return apiJson({
    data: feed.items.map(publicLifeFeedItem),
    meta: { page, limit, total: feed.total, total_pages: Math.ceil(feed.total / limit) },
  }, 200, { cache: "short" });
}

export function OPTIONS() {
  return apiOptions();
}
