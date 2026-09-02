import { adminInternalError, adminSuccess, authorizeAdminApi } from "@/lib/admin-api";
import { getGithubVersionStatus } from "@/lib/admin/deploy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  try {
    // 部署完成后的旧管理页面会通过这个稳定 JSON 接口确认新 release。
    // 绕过进程内短缓存，避免必须手动刷新或等待缓存自然过期。
    return adminSuccess(await getGithubVersionStatus({ bypassCache: true }));
  } catch (error) {
    return adminInternalError("get deploy version", error);
  }
}
