import {
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  paginationMeta,
  parseAdminPagination,
  serializeAdminComment,
} from "@/lib/admin-api";
import { countCommentsForAdmin, listCommentsForAdmin, type AdminCommentStatus } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;

  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;
  const rawStatus = new URL(request.url).searchParams.get("status") ?? "all";
  if (rawStatus !== "all" && rawStatus !== "pending" && rawStatus !== "approved") {
    return adminError("INVALID_STATUS", "status 必须是 all、pending 或 approved", 400);
  }
  const status = rawStatus as AdminCommentStatus;

  try {
    const comments = listCommentsForAdmin({ limit: pagination.limit, offset: pagination.offset, status });
    const total = countCommentsForAdmin(status);
    return adminSuccess(
      comments.map(serializeAdminComment),
      paginationMeta(pagination.page, pagination.limit, total),
    );
  } catch (error) {
    return adminInternalError("list comments", error);
  }
}
