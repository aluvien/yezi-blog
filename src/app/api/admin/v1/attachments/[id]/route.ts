import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  parseAdminId,
} from "@/lib/admin-api";
import { deleteAttachmentAction } from "@/lib/actions/attachments";
import { getAttachment, listAttachments } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "附件 ID 必须是正整数", 400);

  try {
    const attachment = listAttachments().find((item) => item.id === id);
    if (!attachment || !getAttachment(id)) return adminError("ATTACHMENT_NOT_FOUND", "附件不存在", 404);
    return adminSuccess(attachment);
  } catch (error) {
    return adminInternalError("get attachment", error);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "附件 ID 必须是正整数", 400);

  try {
    const result = await deleteAttachmentAction(id);
    if (!result.ok) return adminActionError(result, "ATTACHMENT_DELETE_FAILED");
    return adminSuccess({ id });
  } catch (error) {
    return adminInternalError("delete attachment", error);
  }
}
