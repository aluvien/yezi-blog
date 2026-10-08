import { adminError, authorizeAdminApi } from "@/lib/admin-api";
import { downloadCloudBackup, publicCloudError } from "@/lib/cloud-backup";
import { CLOUD_FILE_PATTERN } from "@/lib/webdav";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const name = new URL(request.url).searchParams.get("name") ?? "";
  if (!CLOUD_FILE_PATTERN.test(name)) return adminError("INVALID_CLOUD_FILE", "请选择有效的云备份文件。", 400);
  try {
    const file = await downloadCloudBackup(name);
    return new Response(file.body, { headers: {
      "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${name}"`,
      "Content-Length": String(file.size), "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return adminError("CLOUD_DOWNLOAD_FAILED", publicCloudError(error), 502); }
}
