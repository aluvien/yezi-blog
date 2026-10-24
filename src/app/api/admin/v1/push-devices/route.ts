import { authorizeAdminApi, adminSuccess, adminError, readAdminJson } from "@/lib/admin-api";
import { pushConfiguration } from "@/lib/apns";
import { parsePushRegistration, registerPushDevice, unregisterPushDevice } from "@/lib/ios-push";
import { currentDataEpoch, dataWriteRejection } from "@/lib/cloud-restore-guard";
import { isDeploymentWriteHoldActive } from "@/lib/deploy-write-guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  return adminSuccess({ configured: pushConfiguration().configured });
}
export async function POST(request: Request) {
  const epoch = currentDataEpoch();
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const json = await readAdminJson(request, 4096); if (!json.ok) return json.response;
  if (auth.session.id === "bearer") return adminError("SESSION_REQUIRED", "设备通知需要 App 登录会话", 403);
  if (dataWriteRejection(epoch) || isDeploymentWriteHoldActive()) return adminError("WRITE_HELD", "网站维护中，请稍后重试", 503);
  const value = parsePushRegistration(json.value);
  if (!value) return adminError("INVALID_PARAMETER", "通知设备参数无效", 400);
  const config = pushConfiguration();
  if (!config.configured) return adminError("PUSH_NOT_CONFIGURED", "网站尚未配置 Apple 推送密钥", 503);
  if (value.site_root !== config.siteRoot) return adminError("SITE_MISMATCH", "通知站点与服务器配置不一致", 400);
  registerPushDevice(value, auth.session.id);
  return adminSuccess({ registered: true });
}
export async function DELETE(request: Request) {
  const epoch = currentDataEpoch();
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const json = await readAdminJson(request, 1024); if (!json.ok) return json.response;
  if (dataWriteRejection(epoch) || isDeploymentWriteHoldActive()) return adminError("WRITE_HELD", "网站维护中，请稍后重试", 503);
  if (!unregisterPushDevice(json.value.installation_id, auth.session.id)) return adminError("INVALID_PARAMETER", "设备编号无效", 400);
  return adminSuccess({ registered: false });
}
