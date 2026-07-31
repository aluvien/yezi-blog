import { apiJson, apiOptions, paginationMeta, parsePagination, publicWork } from "@/lib/api";
import { listWorks } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const works = listWorks();
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const start = (page - 1) * limit;
  return apiJson({
    data: works.slice(start, start + limit).map(publicWork),
    meta: paginationMeta(page, limit, works.length),
  });
}

export function OPTIONS() {
  return apiOptions();
}
