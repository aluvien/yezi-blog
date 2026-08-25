import { adminInternalError, adminSuccess, authorizeAdminApi } from "@/lib/admin-api";
import { getGithubVersionStatusAction } from "@/lib/actions/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  try {
    return adminSuccess(await getGithubVersionStatusAction());
  } catch (error) {
    return adminInternalError("get deploy version", error);
  }
}
