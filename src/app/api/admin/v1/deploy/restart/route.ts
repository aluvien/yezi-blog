import {
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  requireEmptyAdminJsonBody,
} from "@/lib/admin-api";
import { getGithubDeployStatus, scheduleGithubRestart } from "@/lib/admin/deploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let restartInFlight = false;

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const invalidBody = await requireEmptyAdminJsonBody(request);
  if (invalidBody) return invalidBody;
  if (restartInFlight) return adminError("DEPLOY_IN_PROGRESS", "已有一次重启正在执行，请稍后重试", 409);

  restartInFlight = true;
  try {
    const status = await getGithubDeployStatus();
    if (["queued", "building", "switching", "checking", "rolling_back"].includes(status.status)) {
      return adminError("DEPLOY_IN_PROGRESS", "已有一次部署正在执行，请稍后重试", 409);
    }
    const result = await scheduleGithubRestart();
    if (!result.ok) return adminError("DEPLOY_RESTART_FAILED", result.error, 400);
    return adminSuccess({ status: "restarting" });
  } catch (error) {
    return adminInternalError("restart deploy", error);
  } finally {
    restartInFlight = false;
  }
}
