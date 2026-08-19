import {
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  paginationMeta,
  parseAdminPagination,
} from "@/lib/admin-api";
import { listAttachments } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;

  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;

  try {
    const attachments = listAttachments();
    return adminSuccess(
      attachments.slice(pagination.offset, pagination.offset + pagination.limit),
      paginationMeta(pagination.page, pagination.limit, attachments.length),
    );
  } catch (error) {
    return adminInternalError("list attachments", error);
  }
}
