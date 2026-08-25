import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  parseAdminId,
  readAdminJson,
} from "@/lib/admin-api";
import { deleteCategoryByIdAction, updateCategoryAction } from "@/lib/actions/settings";
import { listCategoriesWithPublishedPostCount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const id = parseAdminId((await params).id);
  if (id === null) return adminError("INVALID_ID", "分类 ID 必须是正整数", 400);
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value.name !== "string") return adminError("INVALID_PARAMETER", "name 必须是字符串", 400);

  try {
    const result = await updateCategoryAction(id, body.value.name);
    if (!result.ok) return adminActionError(result, "CATEGORY_UPDATE_FAILED");
    const category = listCategoriesWithPublishedPostCount().find((item) => item.id === id);
    if (!category) return adminInternalError("update category result", new Error("updated category is missing"));
    return adminSuccess(category);
  } catch (error) {
    return adminInternalError("update category", error);
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const id = parseAdminId((await params).id);
  if (id === null) return adminError("INVALID_ID", "分类 ID 必须是正整数", 400);

  try {
    const result = await deleteCategoryByIdAction(id);
    if (!result.ok) return adminActionError(result, "CATEGORY_DELETE_FAILED");
    return adminSuccess({ id });
  } catch (error) {
    return adminInternalError("delete category", error);
  }
}
