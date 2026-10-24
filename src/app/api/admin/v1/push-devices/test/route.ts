import { after } from "next/server";
import { authorizeAdminApi, adminSuccess, adminError, readAdminJson } from "@/lib/admin-api";
import { pushConfiguration } from "@/lib/apns";
import { drainPushOutbox, enqueuePushTest } from "@/lib/ios-push";
import { currentDataEpoch, dataWriteRejection } from "@/lib/cloud-restore-guard";
import { isDeploymentWriteHoldActive } from "@/lib/deploy-write-guard";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const epoch = currentDataEpoch();
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const json = await readAdminJson(request, 1024); if (!json.ok) return json.response;
  if (dataWriteRejection(epoch) || isDeploymentWriteHoldActive()) return adminError("WRITE_HELD", "网站维护中，请稍后重试", 503);
  if (!pushConfiguration().configured) return adminError("PUSH_NOT_CONFIGURED", "网站尚未配置 Apple 推送密钥", 503);
  const result = enqueuePushTest(json.value.installation_id, auth.session.id);
  if (result !== "queued") return adminError(result === "rate_limited" ? "RATE_LIMITED" : "DEVICE_NOT_FOUND", result === "rate_limited" ? "请一分钟后再试" : "请先启用此设备的通知", result === "rate_limited" ? 429 : 404);
  after(() => drainPushOutbox());
  return adminSuccess({ queued: true });
}
