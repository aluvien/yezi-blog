import { adminError, adminSuccess, authorizeAdminApi, readAdminJson } from "@/lib/admin-api";
import { deleteLocalBackup, listLocalBackups, LocalBackupError } from "@/lib/local-backups";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  try { return adminSuccess(listLocalBackups()); }
  catch { return adminError("LOCAL_BACKUP_LIST_FAILED", "无法读取本地备份列表，请检查备份目录权限。", 500); }
}
export async function DELETE(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const body = await readAdminJson(request, 4096); if (!body.ok) return body.response;
  if (typeof body.value.kind !== "string" || typeof body.value.name !== "string" || body.value.confirmation !== "删除备份" || Object.keys(body.value).some(key => !["kind", "name", "confirmation"].includes(key))) return adminError("INVALID_LOCAL_BACKUP", "请选择本地备份并确认删除。", 400);
  try { deleteLocalBackup(body.value.kind, body.value.name); return adminSuccess(listLocalBackups()); }
  catch (error) { return adminError("LOCAL_BACKUP_DELETE_FAILED", error instanceof LocalBackupError ? error.message : "本地备份删除失败，请检查文件权限后刷新列表。", error instanceof LocalBackupError ? error.status : 500); }
}
