import { adminError, authorizeAdminApi } from "@/lib/admin-api";
import { requireCloudSettings } from "@/lib/cloud-backup-config";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  try {
    return new Response(`${requireCloudSettings().key}\n`, { headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": 'attachment; filename="yezi-cloud-recovery-key.txt"', "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch { return adminError("CLOUD_KEY_FAILED", "请先保存云备份配置。", 404); }
}
