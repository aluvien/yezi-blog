import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  parseAdminId,
  readAdminJson,
  serializeAdminReference,
} from "@/lib/admin-api";
import { deleteReferenceLibraryAction, updateReferenceLibraryMetadataAction } from "@/lib/actions/references";
import { getReferenceLibraryItem } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function referenceId(params: Promise<{ id: string }>): Promise<number | null> {
  return parseAdminId((await params).id);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const id = await referenceId(params);
  if (id === null) return adminError("INVALID_ID", "引用 ID 必须是正整数", 400);
  try {
    const reference = getReferenceLibraryItem(id);
    if (!reference) return adminError("REFERENCE_NOT_FOUND", "引用不存在", 404);
    return adminSuccess(serializeAdminReference(reference));
  } catch (error) {
    return adminInternalError("get reference", error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const id = await referenceId(params);
  if (id === null) return adminError("INVALID_ID", "引用 ID 必须是正整数", 400);
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value.category !== "string" || typeof body.value.tags !== "string") {
    return adminError("INVALID_PARAMETER", "category 和 tags 必须是字符串", 400);
  }
  if (body.value.category.trim().length > 80) return adminError("INVALID_PARAMETER", "分类名称不能超过 80 个字符", 400);
  if (!getReferenceLibraryItem(id)) return adminError("REFERENCE_NOT_FOUND", "引用不存在", 404);
  const formData = new FormData();
  formData.set("category", body.value.category);
  formData.set("tags", body.value.tags);
  try {
    await updateReferenceLibraryMetadataAction(id, formData);
    const reference = getReferenceLibraryItem(id);
    if (!reference) return adminInternalError("update reference result", new Error("updated reference is missing"));
    return adminSuccess(serializeAdminReference(reference));
  } catch (error) {
    return adminInternalError("update reference", error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const id = await referenceId(params);
  if (id === null) return adminError("INVALID_ID", "引用 ID 必须是正整数", 400);
  try {
    const result = await deleteReferenceLibraryAction(id);
    if (!result.ok) return adminActionError(result, "REFERENCE_DELETE_FAILED");
    return adminSuccess({ id });
  } catch (error) {
    return adminInternalError("delete reference", error);
  }
}
