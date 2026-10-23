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
  const query = new URL(request.url).searchParams;
  const targetType = query.get("target_type");
  const rawTargetId = query.get("target_id");
  if ((targetType !== null || rawTargetId !== null) &&
      ((targetType !== "post" && targetType !== "moment") || !rawTargetId || !/^[1-9]\d*$/.test(rawTargetId) || !Number.isSafeInteger(Number(rawTargetId)))) {
    return adminError("INVALID_TARGET", "请提供有效的 target_type 和 target_id", 400);
  }
  const target = targetType === "post" || targetType === "moment" ? targetType : undefined;
  const targetId = rawTargetId ? Number(rawTargetId) : undefined;

  try {
    const comments = listCommentsForAdmin({ limit: pagination.limit, offset: pagination.offset, status, targetType: target, targetId });
    const total = countCommentsForAdmin(status, target, targetId);
    return adminSuccess(
      comments.map(serializeAdminComment),
      paginationMeta(pagination.page, pagination.limit, total),
    );
  } catch (error) {
    return adminInternalError("list comments", error);
  }
}
