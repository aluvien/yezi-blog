import {
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  requireEmptyAdminJsonBody,
} from "@/lib/admin-api";
import { syncLatestGithub } from "@/lib/admin/deploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let syncInFlight = false;

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const invalidBody = await requireEmptyAdminJsonBody(request);
  if (invalidBody) return invalidBody;
  if (syncInFlight) return adminError("DEPLOY_IN_PROGRESS", "已有一次同步正在执行，请稍后重试", 409);

  syncInFlight = true;
  try {
    const result = await syncLatestGithub();
    if (!result.ok) return adminError("DEPLOY_SYNC_FAILED", result.error, 400);
    return adminSuccess({ status: "success", message: result.message });
  } catch (error) {
    return adminInternalError("sync deploy", error);
  } finally {
    syncInFlight = false;
  }
}
