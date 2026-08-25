import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  hasOwn,
  parseAdminId,
  readAdminJson,
  serializeAdminWork,
} from "@/lib/admin-api";
import { deleteWorkAction, updateWorkAction } from "@/lib/actions/works";
import { getWork } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "作品 ID 必须是正整数", 400);
  const existing = getWork(id);
  if (!existing) return adminError("WORK_NOT_FOUND", "作品不存在", 404);

  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const data = {
    title: (hasOwn(body.value, "title") ? body.value.title : existing.title) as string,
    description: (hasOwn(body.value, "description") ? body.value.description : existing.description) as string,
    cover: (hasOwn(body.value, "cover") ? body.value.cover : existing.cover) as string | null,
    link: (hasOwn(body.value, "link") ? body.value.link : existing.link ?? "") as string,
    sort_order: (hasOwn(body.value, "sort_order") ? body.value.sort_order : existing.sort_order) as number,
  };

  try {
    const result = await updateWorkAction(id, data);
    if (!result.ok) return adminActionError(result);
    const work = getWork(id);
    if (!work) return adminInternalError("update work response", new Error("work is missing"));
    return adminSuccess(serializeAdminWork(work));
  } catch (error) {
    return adminInternalError("update work", error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "作品 ID 必须是正整数", 400);
  if (!getWork(id)) return adminError("WORK_NOT_FOUND", "作品不存在", 404);

  try {
    const result = await deleteWorkAction(id);
    if (!result.ok) return adminActionError(result);
    return adminSuccess({ id });
  } catch (error) {
    return adminInternalError("delete work", error);
  }
}
