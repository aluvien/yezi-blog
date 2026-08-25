import {
  adminError,
  adminInternalError,
  adminSuccess,
  adminActionError,
  authorizeAdminApi,
  paginationMeta,
  parseAdminPostInput,
  parseAdminPagination,
  readAdminJson,
  readQueryText,
  serializeAdminPost,
  serializeAdminPostSummary,
} from "@/lib/admin-api";
import { createPostAction } from "@/lib/actions/posts";
import {
  countAllPosts,
  getContentMetrics,
  getContentMetricsBulk,
  getPost,
  getPostAttachments,
  listAllPosts,
  listArticleReferenceSnapshotsForPost,
  type AdminPostStatus,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;

  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;
  const search = readQueryText(request, "search", 120);
  if (search instanceof Response) return search;

  const rawStatus = new URL(request.url).searchParams.get("status") ?? "all";
  if (rawStatus !== "all" && rawStatus !== "draft" && rawStatus !== "published") {
    return adminError("INVALID_STATUS", "status 必须是 all、draft 或 published", 400);
  }
  const status = rawStatus as AdminPostStatus;

  try {
    const posts = listAllPosts({ limit: pagination.limit, offset: pagination.offset, status, search });
    const metrics = getContentMetricsBulk("post", posts.map((post) => post.id));
    const total = countAllPosts({ status, search });
    return adminSuccess(
      posts.map((post) => serializeAdminPostSummary(post, metrics.get(post.id) ?? { views: 0, likes: 0 })),
      paginationMeta(pagination.page, pagination.limit, total),
    );
  } catch (error) {
    return adminInternalError("list posts", error);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;

  const input = parseAdminPostInput(body.value);
  if (!input.ok) return input.response;

  try {
    const result = await createPostAction(input.value);
    if (!result.ok) return adminActionError(result);
    const created = result.data;
    if (!created || typeof created !== "object" || !("id" in created) || typeof created.id !== "number") {
      return adminInternalError("create post response", new Error("created post is missing"));
    }
    return adminSuccess(serializePostDetail(created.id));
  } catch (error) {
    return adminInternalError("create post", error);
  }
}

function serializePostDetail(id: number): Record<string, unknown> {
  const post = getPost(id);
  if (!post) throw new Error("created post is missing");
  return serializeAdminPost(post, {
    metrics: getContentMetrics("post", post.id),
    attachmentIds: getPostAttachments(post.id).map((attachment) => attachment.id),
    referenceSnapshots: listArticleReferenceSnapshotsForPost(post.id),
  });
}
