import { adminError, adminSuccess, authorizeAdminApi } from "@/lib/admin-api";
import { requireCloudSettings } from "@/lib/cloud-backup-config";
import { publicCloudError } from "@/lib/cloud-backup";
import { WebDavClient } from "@/lib/webdav";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  try { return adminSuccess(await new WebDavClient(requireCloudSettings()).list()); }
  catch (error) { return adminError("CLOUD_LIST_FAILED", publicCloudError(error), 502); }
}
