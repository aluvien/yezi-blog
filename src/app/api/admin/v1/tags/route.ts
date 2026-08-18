import {
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  paginationMeta,
  parseAdminPagination,
} from "@/lib/admin-api";
import { listAllTags } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;

  try {
    const tags = listAllTags();
    return adminSuccess(
      tags.slice(pagination.offset, pagination.offset + pagination.limit),
      paginationMeta(pagination.page, pagination.limit, tags.length),
    );
  } catch (error) {
    return adminInternalError("list tags", error);
  }
}
