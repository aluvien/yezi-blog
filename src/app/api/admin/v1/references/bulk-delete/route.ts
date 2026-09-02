import {
  adminActionError,
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  readAdminJson,
} from "@/lib/admin-api";
import { deleteReferenceMany } from "@/lib/admin/references";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const body = await readAdminJson(request);
  if (!body.ok) return body.response;
  const ids = body.value.ids;
  if (!Array.isArray(ids) || ids.some((id) => !Number.isInteger(id) || id < 1)) {
    return adminError("INVALID_PARAMETER", "ids 必须是正整数数组", 400);
  }
  try {
    const result = await deleteReferenceMany(ids as number[]);
    if (!result.ok) return adminActionError(result, "REFERENCE_BULK_DELETE_FAILED");
    return adminSuccess(result.data ?? { deletedCount: ids.length });
  } catch (error) {
    return adminInternalError("bulk delete references", error);
  }
}
