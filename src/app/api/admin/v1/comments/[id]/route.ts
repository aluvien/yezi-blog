import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  parseAdminId,
  readAdminJson,
  serializeAdminComment,
} from "@/lib/admin-api";
import {
  approveCommentById,
  deleteCommentById,
  hideCommentById,
  replyCommentById,
} from "@/lib/admin/comments";
import { getComment, getCommentForAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "评论 ID 必须是正整数", 400);
  if (!getComment(id)) return adminError("COMMENT_NOT_FOUND", "评论不存在", 404);

  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const action = body.value.action;
  if (action !== "approve" && action !== "hide" && action !== "reply") {
    return adminError("INVALID_ACTION", "action 必须是 approve、hide 或 reply", 400);
  }
  const rawReply = body.value.reply;
  if (action === "reply" && rawReply !== undefined && rawReply !== null && typeof rawReply !== "string") {
    return adminError("INVALID_PARAMETER", "reply 必须是字符串", 400);
  }

  try {
    const result = action === "approve"
      ? await approveCommentById(id)
      : action === "hide"
        ? await hideCommentById(id)
        : await replyCommentById(id, typeof rawReply === "string" ? rawReply : "");
    if (!result.ok) return adminActionError(result);
    const comment = getCommentForAdmin(id);
    if (!comment) return adminInternalError("update comment response", new Error("comment is missing"));
    return adminSuccess(serializeAdminComment(comment));
  } catch (error) {
    return adminInternalError("update comment", error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "评论 ID 必须是正整数", 400);
  if (!getComment(id)) return adminError("COMMENT_NOT_FOUND", "评论不存在", 404);

  try {
    const result = await deleteCommentById(id);
    if (!result.ok) return adminActionError(result);
    return adminSuccess({ id });
  } catch (error) {
    return adminInternalError("delete comment", error);
  }
}
