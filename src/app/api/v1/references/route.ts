import { apiJson, apiOptions, paginationMeta, parseCollectionFilter, parsePagination, publicReference } from "@/lib/api";
import { countReferenceLibrary, listReferenceLibrary } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public reference cards; reader archives and linked draft metadata remain admin-only. */
export function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { page, limit } = parsePagination(params);
  const keyword = parseCollectionFilter(params, "q", 120);
  const category = parseCollectionFilter(params, "category");
  const filters = { keyword: keyword || undefined, category: category || undefined };
  const references = listReferenceLibrary({ ...filters, limit, offset: (page - 1) * limit });
  return apiJson({
    data: references.map(publicReference),
    meta: paginationMeta(page, limit, countReferenceLibrary(filters)),
  });
}

export function OPTIONS() {
  return apiOptions();
}
