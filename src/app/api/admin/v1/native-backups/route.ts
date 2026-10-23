import { adminError, adminSuccess, authorizeAdminApi, readAdminJson } from "@/lib/admin-api";
import { latestBackupJob, listBackups, startBackupJob } from "@/lib/backup-management";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  return adminSuccess({ backups: listBackups(), job: latestBackupJob(), completeEnabled: Boolean(process.env.DATA_BACKUP_KEY?.trim()), restoreEnabled: process.env.DEPLOY_RESTART_MODE !== "direct" });
}
export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const body = await readAdminJson(request); if (!body.ok) return body.response;
  const { action, kind, backupId, confirmation } = body.value;
  if ((action !== "create" && action !== "restore") || (kind !== "database" && kind !== "complete")) return adminError("INVALID_BACKUP_ACTION", "备份操作无效", 400);
  if (action === "restore" && (typeof backupId !== "string" || confirmation !== backupId)) return adminError("RESTORE_CONFIRMATION_REQUIRED", "恢复前必须确认选中的备份", 400);
  try { return adminSuccess(await startBackupJob(action, kind, typeof backupId === "string" ? backupId : undefined)); }
  catch (error) { return adminError("BACKUP_UNAVAILABLE", error instanceof Error ? error.message : "备份任务无法启动", 409); }
}
