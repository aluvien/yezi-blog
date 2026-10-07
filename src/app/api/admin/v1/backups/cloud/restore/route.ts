import { revalidatePath } from "next/cache";
import { adminError, adminSuccess, authorizeAdminApi, readAdminJson } from "@/lib/admin-api";
import { applyCloudRestore } from "@/lib/cloud-backup-restore";
import { publicCloudError } from "@/lib/cloud-backup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const body = await readAdminJson(request, 4096); if (!body.ok) return body.response;
  if (typeof body.value.id !== "string" || body.value.confirmation !== "恢复数据" || Object.keys(body.value).some(key => !["id", "confirmation"].includes(key))) return adminError("RESTORE_CONFIRMATION_REQUIRED", "请先查看校验结果，并填写“恢复数据”确认覆盖。", 400);
  try {
    const result = await applyCloudRestore(body.value.id, body.value.confirmation);
    revalidatePath("/", "layout");
    return adminSuccess(result);
  } catch (error) { return adminError("CLOUD_RESTORE_FAILED", publicCloudError(error), 409); }
}
