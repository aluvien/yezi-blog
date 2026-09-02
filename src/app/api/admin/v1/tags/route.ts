import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  paginationMeta,
  parseAdminPagination,
  readAdminJson,
} from "@/lib/admin-api";
import { deleteTag, renameTag } from "@/lib/admin/settings";
import { listAllTags } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;

  try {
    const tags = listAllTags();
    return adminSuccess(
      tags.slice(pagination.offset, pagination.offset + pagination.limit),
      paginationMeta(pagination.page, pagination.limit, tags.length),
    );
  } catch (error) {
    return adminInternalError("list tags", error);
  }
}

export async function PATCH(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value.old_tag !== "string" || typeof body.value.new_tag !== "string") {
    return adminError("INVALID_PARAMETER", "old_tag 和 new_tag 必须是字符串", 400);
  }
  try {
    const result = await renameTag(body.value.old_tag, body.value.new_tag);
    if (!result.ok) return adminActionError(result, "TAG_RENAME_FAILED");
    return adminSuccess({ tag: body.value.new_tag.trim().replace(/^#+/, ""), tags: listAllTags() });
  } catch (error) {
    return adminInternalError("rename tag", error);
  }
}

export async function DELETE(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value.tag !== "string") return adminError("INVALID_PARAMETER", "tag 必须是字符串", 400);
  try {
    const result = await deleteTag(body.value.tag);
    if (!result.ok) return adminActionError(result, "TAG_DELETE_FAILED");
    return adminSuccess({ tag: body.value.tag.trim().replace(/^#+/, ""), tags: listAllTags() });
  } catch (error) {
    return adminInternalError("delete tag", error);
  }
}
