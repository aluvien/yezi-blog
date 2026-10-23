import fs from "node:fs";
import path from "node:path";
import { promises as fsPromises } from "node:fs";
import { Readable } from "node:stream";
import crypto from "node:crypto";
import { uploadAbsolutePath } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
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
export async function GET(request: Request) {
  const url = new URL(request.url);
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname.replace(/^\/uploads\//, ""));
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  if (!rel || rel.includes("..")) return new Response("Not Found", { status: 404 });
  const abs = uploadAbsolutePath(`/uploads/${rel}`);
  if (!abs) return new Response("Not Found", { status: 404 });
  let stat: Awaited<ReturnType<typeof fsPromises.stat>>;
  try {
    stat = await fsPromises.stat(abs);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  if (!stat.isFile()) return new Response("Not Found", { status: 404 });
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME[ext] || "application/octet-stream";
  const etag = `"${crypto.createHash("sha1").update(`${stat.size}:${stat.mtimeMs}`).digest("base64url")}"`;
  const ifNoneMatch = request.headers.get("if-none-match");
  const ifModifiedSince = request.headers.get("if-modified-since");
  if (ifNoneMatch === etag || (!ifNoneMatch && ifModifiedSince && new Date(ifModifiedSince).getTime() >= Math.floor(stat.mtimeMs / 1000) * 1000)) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "public, max-age=60, must-revalidate" },
    });
  }
  let start = 0;
  let end = stat.size - 1;
  let partial = false;
  const range = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const rangeAllowed = !ifRange || ifRange === etag || ifRange === stat.mtime.toUTCString();
  if (range && rangeAllowed) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]) || !stat.size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    if (!match[1]) {
      const suffix = Number(match[2]);
      if (!Number.isSafeInteger(suffix) || suffix <= 0) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
      start = Math.max(0, stat.size - suffix);
    } else {
      start = Number(match[1]);
      if (match[2]) end = Math.min(end, Number(match[2]));
    }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= stat.size || end < start) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${stat.size}` } });
    }
    partial = true;
  }
  const stream = request.method === "HEAD" ? null : Readable.toWeb(fs.createReadStream(abs, partial ? { start, end } : undefined)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: partial ? 206 : 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(partial ? end - start + 1 : stat.size),
      "Accept-Ranges": "bytes",
      ...(partial ? { "Content-Range": `bytes ${start}-${end}/${stat.size}` } : {}),
      "Last-Modified": stat.mtime.toUTCString(),
      ETag: etag,
      "Cache-Control": "public, max-age=60, must-revalidate",
    },
  });
}

export const HEAD = GET;
