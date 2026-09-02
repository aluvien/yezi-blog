import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  readAdminJson,
} from "@/lib/admin-api";
import { clearUnusedAttachments } from "@/lib/admin/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (body.value.confirm !== true) return adminError("CONFIRMATION_REQUIRED", "清理未使用附件必须传入 confirm: true", 400);
  try {
    const result = await clearUnusedAttachments();
    if (!result.ok) return adminActionError(result, "ATTACHMENT_CLEANUP_FAILED");
    return adminSuccess(result.data ?? { deletedCount: 0, skippedCount: 0 });
  } catch (error) {
    return adminInternalError("cleanup unused attachments", error);
  }
}
