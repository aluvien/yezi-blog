import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  paginationMeta,
  parseAdminReferenceSnapshot,
  parseAdminPagination,
  readAdminJson,
  readQueryText,
  serializeAdminReference,
} from "@/lib/admin-api";
import { saveReferenceLibraryAction } from "@/lib/actions/posts";
import { countReferenceLibrary, getReferenceLibraryItem, listReferenceLibrary } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  const pagination = parseAdminPagination(request);
  if (pagination instanceof Response) return pagination;
  const search = readQueryText(request, "search", 120);
  if (search instanceof Response) return search;
  const category = readQueryText(request, "category", 80);
  if (category instanceof Response) return category;
  const tag = readQueryText(request, "tag", 80);
  if (tag instanceof Response) return tag;

  try {
    const filters = { keyword: search, category, tag };
    const references = listReferenceLibrary({ ...filters, limit: pagination.limit, offset: pagination.offset });
    return adminSuccess(references.map(serializeAdminReference), paginationMeta(pagination.page, pagination.limit, countReferenceLibrary(filters)));
  } catch (error) {
    return adminInternalError("list references", error);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const snapshot = parseAdminReferenceSnapshot(body.value.snapshot);
  if (!snapshot) return adminError("INVALID_PARAMETER", "snapshot 必须是有效的 ArticleReferenceSnapshot", 400);
  if (body.value.category !== undefined && typeof body.value.category !== "string") return adminError("INVALID_PARAMETER", "category 必须是字符串", 400);
  if (body.value.tags !== undefined && typeof body.value.tags !== "string") return adminError("INVALID_PARAMETER", "tags 必须是字符串", 400);

  try {
    const result = await saveReferenceLibraryAction(snapshot, body.value.category as string | undefined, body.value.tags as string | undefined);
    if (!result.ok) return adminActionError(result, "REFERENCE_CREATE_FAILED");
    const id = (result.data as { id?: unknown } | undefined)?.id;
    const saved = typeof id === "number" ? getReferenceLibraryItem(id) : undefined;
    if (!saved) return adminInternalError("create reference result", new Error("saved reference is missing"));
    return adminSuccess(serializeAdminReference(saved));
  } catch (error) {
    return adminInternalError("create reference", error);
  }
}
