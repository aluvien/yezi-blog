import { apiJson, apiOptions, paginationMeta, parsePagination, publicWork } from "@/lib/api";
import { countWorks, listWorks } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const works = listWorks({ limit, offset: (page - 1) * limit });
  return apiJson({
    data: works.map(publicWork),
    meta: paginationMeta(page, limit, countWorks()),
  }, 200, { cache: "short" });
}

export function OPTIONS() {
  return apiOptions();
}
