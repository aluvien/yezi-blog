import { after } from "next/server";
import { adminApiJson, adminError, adminSuccess, authorizeAdminApi, requireEmptyAdminJsonBody } from "@/lib/admin-api";
import { executeAdminBackup, getAdminBackupStatus, startAdminBackup } from "@/lib/admin-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  try { return adminSuccess(getAdminBackupStatus()); } catch {
    return adminError("BACKUP_STATUS_FAILED", "无法读取备份状态，请检查备份目录权限。", 500);
  }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  const invalid = await requireEmptyAdminJsonBody(request);
  if (invalid) return invalid;
  try {
    const task = startAdminBackup();
    if (task.started) after(() => executeAdminBackup(task.status.id));
    return adminApiJson({ data: task.status, meta: { started: task.started } }, 202);
  } catch {
    return adminError("BACKUP_START_FAILED", "无法创建备份任务，请检查备份目录权限。", 500);
  }
}
