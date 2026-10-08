import fs from "node:fs";
import { Readable } from "node:stream";
import { adminError, authorizeAdminApi } from "@/lib/admin-api";
import { LocalBackupError, openLocalBackupDownload } from "@/lib/local-backups";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  const params = new URL(request.url).searchParams;
  try {
    const file = openLocalBackupDownload(params.get("kind") ?? "", params.get("name") ?? "");
    const stream = fs.createReadStream("", { fd: file.fd, autoClose: true });
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { headers: {
      "Content-Type": file.type, "Content-Disposition": `attachment; filename="${file.name}"`, "Content-Length": String(file.size),
      "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) { return adminError("LOCAL_BACKUP_DOWNLOAD_FAILED", error instanceof LocalBackupError ? error.message : "本地备份暂时不可读取，请刷新列表。", error instanceof LocalBackupError ? error.status : 500); }
}
