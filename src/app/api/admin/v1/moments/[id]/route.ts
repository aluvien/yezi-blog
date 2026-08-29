import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  hasOwn,
  parseAdminId,
  readAdminJson,
  serializeAdminMoment,
} from "@/lib/admin-api";
import { deleteMomentAction, updateMomentAction } from "@/lib/actions/moments";
import { getContentMetrics, getMoment } from "@/lib/db";
import { parseMomentImages } from "@/lib/moments";
import { parsePostTags } from "@/lib/post-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "动态 ID 必须是正整数", 400);
  const existing = getMoment(id);
  if (!existing) return adminError("MOMENT_NOT_FOUND", "动态不存在", 404);

  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const content = hasOwn(body.value, "content") ? body.value.content : existing.content;
  const images = hasOwn(body.value, "images") ? body.value.images : parseMomentImages(existing);
  const tags = hasOwn(body.value, "tags")
    ? parsePostTags(typeof body.value.tags === "string" ? body.value.tags : JSON.stringify(body.value.tags ?? []))
    : parsePostTags(existing.tags);

  try {
    const result = await updateMomentAction(id, { content: content as string, images: images as string[], tags });
    if (!result.ok) return adminActionError(result);
    const moment = getMoment(id);
    if (!moment) return adminInternalError("update moment response", new Error("moment is missing"));
    return adminSuccess(serializeAdminMoment(moment, getContentMetrics("moment", id)));
  } catch (error) {
    return adminInternalError("update moment", error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const { id: rawId } = await params;
  const id = parseAdminId(rawId);
  if (id === null) return adminError("INVALID_ID", "动态 ID 必须是正整数", 400);
  if (!getMoment(id)) return adminError("MOMENT_NOT_FOUND", "动态不存在", 404);

  try {
    const result = await deleteMomentAction(id);
    if (!result.ok) return adminActionError(result);
    return adminSuccess({ id });
  } catch (error) {
    return adminInternalError("delete moment", error);
  }
}
