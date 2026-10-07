import fs from "node:fs";
import { Readable } from "node:stream";
import { adminError, authorizeAdminApi } from "@/lib/admin-api";
import { getAdminBackupDownload } from "@/lib/admin-backup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;
  try {
    const file = getAdminBackupDownload(new URL(request.url).searchParams.get("id") ?? "");
    if (!file) return adminError("BACKUP_NOT_FOUND", "备份未完成或已失效，请重新备份。", 404);
    const stream = fs.createReadStream(file.path);
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${file.name}"`,
        "Content-Length": String(file.size),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-API-Version": "v1",
      },
    });
  } catch {
    return adminError("BACKUP_DOWNLOAD_FAILED", "备份文件暂时不可读取，请重新备份。", 500);
  }
}
