import { apiJson, apiOptions, paginationMeta, parsePagination, publicMoment } from "@/lib/api";
import { countApprovedComments, listMoments } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  const moments = listMoments();
  const { page, limit } = parsePagination(new URL(request.url).searchParams);
  const start = (page - 1) * limit;
  return apiJson({
    data: moments.slice(start, start + limit).map((moment) => publicMoment(moment, countApprovedComments("moment", moment.id))),
    meta: paginationMeta(page, limit, moments.length),
  });
}

export function OPTIONS() {
  return apiOptions();
}
