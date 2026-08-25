import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  parseAdminId,
  parseAdminPostInput,
  readAdminJson,
  serializeAdminPost,
} from "@/lib/admin-api";
import { deletePostAction, updatePostAction } from "@/lib/actions/posts";
import type { PostInput } from "@/lib/actions/posts";
import {
  getContentMetrics,
  getPost,
  getPostAttachments,
  listArticleReferenceSnapshotsForPost,
} from "@/lib/db";
import { parsePostTags } from "@/lib/post-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "文章 ID 必须是正整数", 400);

  try {
    const post = getPost(id);
    if (!post) return adminError("POST_NOT_FOUND", "文章不存在", 404);
    return adminSuccess(serializePost(id));
  } catch (error) {
    return adminInternalError("get post", error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "文章 ID 必须是正整数", 400);

  const existing = getPost(id);
  if (!existing) return adminError("POST_NOT_FOUND", "文章不存在", 404);
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const input = parseAdminPostInput(body.value, getPostInputDefaults(existing));
  if (!input.ok) return input.response;

  try {
    const result = await updatePostAction(id, input.value);
    if (!result.ok) return adminActionError(result);
    return adminSuccess(serializePost(id));
  } catch (error) {
    return adminInternalError("update post", error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "文章 ID 必须是正整数", 400);
  if (!getPost(id)) return adminError("POST_NOT_FOUND", "文章不存在", 404);

  try {
    const result = await deletePostAction(id);
    if (!result.ok) return adminActionError(result);
    return adminSuccess({ id });
  } catch (error) {
    return adminInternalError("delete post", error);
  }
}

function serializePost(id: number): Record<string, unknown> {
  const post = getPost(id);
  if (!post) throw new Error("post is missing");
  return serializeAdminPost(post, {
    metrics: getContentMetrics("post", id),
    attachmentIds: getPostAttachments(id).map((attachment) => attachment.id),
    referenceSnapshots: listArticleReferenceSnapshotsForPost(id),
  });
}

function getPostInputDefaults(post: NonNullable<ReturnType<typeof getPost>>): Partial<PostInput> {
  return {
    title: post.title,
    slug: post.slug,
    content: post.content,
    cover: post.cover,
    category: post.category,
    tags: parsePostTags(post.tags).join(", "),
    attachmentIds: getPostAttachments(post.id).map((attachment) => attachment.id),
    referenceSnapshots: listArticleReferenceSnapshotsForPost(post.id),
    status: post.status,
  };
}
