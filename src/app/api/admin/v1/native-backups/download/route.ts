import fs from "node:fs";
import { Readable } from "node:stream";
import { adminError, authorizeAdminApi } from "@/lib/admin-api";
import { backupFile } from "@/lib/backup-management";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request); if (!auth.ok) return auth.response;
  try {
    const file = backupFile(new URL(request.url).searchParams.get("id") ?? "");
    const stream = fs.createReadStream(file.path);
    request.signal.addEventListener("abort", () => stream.destroy(), { once: true });
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers: {
      "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${file.name}"`,
      "Content-Length": String(fs.statSync(file.path).size), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    }});
  } catch { return adminError("BACKUP_NOT_FOUND", "备份不存在或已被清理", 404); }
}
