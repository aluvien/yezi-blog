import { adminError, adminSuccess, authorizeAdminApi, readAdminJson } from "@/lib/admin-api";
import { requireCloudSettings } from "@/lib/cloud-backup-config";
import { deleteCloudBackup, getCloudTask, publicCloudError } from "@/lib/cloud-backup";
import { CLOUD_FILE_PATTERN, WebDavClient } from "@/lib/webdav";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  try { return adminSuccess(await new WebDavClient(requireCloudSettings()).list()); }
  catch (error) { return adminError("CLOUD_LIST_FAILED", publicCloudError(error), 502); }
}
export async function DELETE(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const body = await readAdminJson(request, 4096); if (!body.ok) return body.response;
  if (typeof body.value.name !== "string" || !CLOUD_FILE_PATTERN.test(body.value.name) || body.value.confirmation !== "删除备份" || Object.keys(body.value).some(key => !["name", "confirmation"].includes(key))) return adminError("INVALID_CLOUD_DELETE", "请选择有效的云备份，并确认删除。", 400);
  try {
    await deleteCloudBackup(body.value.name);
    return adminSuccess({ name: body.value.name, task: getCloudTask() });
  } catch (error) { return adminError("CLOUD_DELETE_FAILED", publicCloudError(error), 409); }
}
