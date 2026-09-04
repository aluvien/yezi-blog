import { apiJson, apiOptions, paginationMeta, parsePagination, publicLifeEvent } from "@/lib/api";
import { countLifeEvents, listLifeEvents } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const events = listLifeEvents({ limit, offset: (page - 1) * limit });
  return apiJson({
    data: events.map(publicLifeEvent),
    meta: paginationMeta(page, limit, countLifeEvents()),
  }, 200, { cache: "short" });
}

export function OPTIONS() {
  return apiOptions();
}
