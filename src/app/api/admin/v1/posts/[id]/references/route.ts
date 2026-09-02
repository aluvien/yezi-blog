import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  parseAdminId,
  parseAdminReferenceSnapshot,
  readAdminJson,
  serializeAdminPost,
} from "@/lib/admin-api";
import { attachArticleReferenceToPost } from "@/lib/admin/posts";
import { getContentMetrics, getPost, getPostAttachments, listArticleReferenceSnapshotsForPost } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const id = parseAdminId((await params).id);
  if (id === null) return adminError("INVALID_ID", "文章 ID 必须是正整数", 400);
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const snapshot = parseAdminReferenceSnapshot(body.value.snapshot);
  if (!snapshot) return adminError("INVALID_PARAMETER", "snapshot 必须是有效的 ArticleReferenceSnapshot", 400);
  try {
    const result = await attachArticleReferenceToPost(id, snapshot);
    if (!result.ok) return adminActionError(result, "POST_REFERENCE_ATTACH_FAILED");
    const post = getPost(id);
    if (!post) return adminInternalError("attach reference result", new Error("post is missing"));
    return adminSuccess(serializeAdminPost(post, {
      metrics: getContentMetrics("post", id),
      attachmentIds: getPostAttachments(id).map((attachment) => attachment.id),
      referenceSnapshots: listArticleReferenceSnapshotsForPost(id),
    }));
  } catch (error) {
    return adminInternalError("attach reference to post", error);
  }
}
