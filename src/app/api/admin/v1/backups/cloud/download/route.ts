import fs from "node:fs";
import { Readable } from "node:stream";
import { adminError, authorizeAdminApi } from "@/lib/admin-api";
import { preparedCloudDownload } from "@/lib/cloud-backup";
import { safetyCloudDownload } from "@/lib/cloud-backup-restore";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  try {
    const safety = params.get("safety");
    const file = safety ? safetyCloudDownload(safety) : preparedCloudDownload(params.get("id") ?? "");
    return new Response(Readable.toWeb(fs.createReadStream(file.path)) as ReadableStream<Uint8Array>, { headers: { "Content-Type": "application/gzip", "Content-Disposition": 'attachment; filename="yezi-complete-backup.tar.gz"', "Content-Length": String(file.size), "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" } });
  } catch { return adminError("CLOUD_DOWNLOAD_FAILED", "备份不可下载或校验已过期，请重新下载校验。", 404); }
}
