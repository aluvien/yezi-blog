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
import { createCategoryByNameAction } from "@/lib/actions/settings";
import { listCategoriesWithPublishedPostCount } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;

  try {
    const categories = listCategoriesWithPublishedPostCount();
    return adminSuccess(
      categories.slice(pagination.offset, pagination.offset + pagination.limit),
      paginationMeta(pagination.page, pagination.limit, categories.length),
    );
  } catch (error) {
    return adminInternalError("list categories", error);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  if (typeof body.value.name !== "string") return adminError("INVALID_PARAMETER", "name 必须是字符串", 400);

  try {
    const result = await createCategoryByNameAction(body.value.name);
    if (!result.ok) return adminActionError(result, "CATEGORY_CREATE_FAILED");
    const createdId = (result.data as { id?: unknown } | undefined)?.id;
    const category = listCategoriesWithPublishedPostCount().find((item) => item.id === createdId);
    if (!category) return adminInternalError("create category result", new Error("created category is missing"));
    return adminSuccess(category);
  } catch (error) {
    return adminInternalError("create category", error);
  }
}
