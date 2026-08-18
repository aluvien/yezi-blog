import {
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  paginationMeta,
  parseAdminPagination,
} from "@/lib/admin-api";
import { listCategoriesWithPublishedPostCount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;

  try {
    const categories = listCategoriesWithPublishedPostCount();
    return adminSuccess(
      categories.slice(pagination.offset, pagination.offset + pagination.limit),
      paginationMeta(pagination.page, pagination.limit, categories.length),
    );
  } catch (error) {
    return adminInternalError("list categories", error);
  }
}
