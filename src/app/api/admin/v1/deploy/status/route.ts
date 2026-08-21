import { adminInternalError, adminSuccess, authorizeAdminApi } from "@/lib/admin-api";
import { getGithubDeployStatusAction } from "@/lib/actions/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;
  try {
    return adminSuccess(await getGithubDeployStatusAction());
  } catch (error) {
    return adminInternalError("get deploy status", error);
  }
}
