import fs from "node:fs";
import path from "node:path";
import { uploadAbsolutePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

// standalone server 启动时读 public 清单，运行时新上传的文件不会被自动提供（404）。
// 这里用 route handler 实时读文件系统，让上传后的 Logo/头像/附件立即可访问。
export function GET(request: Request) {
  const url = new URL(request.url);
  const rel = decodeURIComponent(url.pathname.replace(/^\/uploads\//, ""));
  if (!rel || rel.includes("..")) return new Response("Not Found", { status: 404 });
  const abs = uploadAbsolutePath(`/uploads/${rel}`);
  if (!abs) return new Response("Not Found", { status: 404 });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return new Response("Not Found", { status: 404 });
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const buf = fs.readFileSync(abs);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
