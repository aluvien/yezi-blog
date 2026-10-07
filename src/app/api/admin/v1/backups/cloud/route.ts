import { after } from "next/server";
import { adminApiJson, adminError, adminSuccess, authorizeAdminApi, readAdminJson } from "@/lib/admin-api";
import { publicCloudSettings, saveCloudSettings } from "@/lib/cloud-backup-config";
import { executeCloudTask, getCloudTask, isCloudBusy, publicCloudError, startCloudTask } from "@/lib/cloud-backup";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  try { return adminSuccess({ settings: publicCloudSettings(), task: getCloudTask() }); }
  catch { return adminError("CLOUD_CONFIG_FAILED", "云备份配置或状态不可读取。", 500); }
}
export async function PATCH(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const body = await readAdminJson(request, 8192); if (!body.ok) return body.response;
  try {
    if (isCloudBusy()) return adminError("CLOUD_BUSY", "任务执行中，请稍后再修改配置。", 409);
    return adminSuccess(saveCloudSettings(body.value));
  } catch (error) { return adminError("INVALID_CLOUD_CONFIG", error instanceof Error && /^(请输入|WebDAV 地址|备份目录|恢复密钥|云备份配置)/.test(error.message) ? error.message : "云备份配置保存失败，请检查配置目录权限。", 400); }
}
export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const body = await readAdminJson(request, 4096); if (!body.ok) return body.response;
  const { action, name } = body.value;
  if (!["test", "backup", "prepare"].includes(String(action)) || Object.keys(body.value).some(key => !["action", "name"].includes(key)) || (action !== "prepare" && name !== undefined) || (action === "prepare" && typeof name !== "string")) return adminError("INVALID_CLOUD_ACTION", "云备份操作无效。", 400);
  try {
    const result = startCloudTask(action as "test" | "backup" | "prepare", name as string | undefined);
    if (result.started) after(() => executeCloudTask(result.task.id));
    return adminApiJson({ data: result.task }, 202);
  } catch (error) { return adminError("CLOUD_START_FAILED", publicCloudError(error), 409); }
}
