import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  readAdminJson,
} from "@/lib/admin-api";
import { deleteUntrackedAttachmentAction } from "@/lib/actions/attachments";
import { parseUntrackedUploadPath } from "./_path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (body.value.confirm !== true) return adminError("CONFIRMATION_REQUIRED", "删除未追踪附件必须传入 confirm: true", 400);
  const path = parseUntrackedUploadPath(body.value.path);
  if (!path) return adminError("INVALID_PATH", "path 必须是 uploads 目录内的相对文件路径", 400);
  try {
    const result = await deleteUntrackedAttachmentAction(path);
    if (!result.ok) return adminActionError(result, "UNTRACKED_ATTACHMENT_DELETE_FAILED");
    return adminSuccess(result.data ?? { path, deletedCount: 1, skippedCount: 0 });
  } catch (error) {
    return adminInternalError("delete untracked attachment", error);
  }
}
