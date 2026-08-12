import fs from "node:fs";
import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getCachedReferenceImagePath } from "@/lib/article-reference-archive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function imageContentType(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return ({ avif: "image/avif", gif: "image/gif", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", svg: "image/svg+xml" })[extension || ""] || "application/octet-stream";
}

export async function GET(_request: Request, { params }: { params: Promise<{ key: string; file: string }> }) {
  if (!await requireAdminApi()) return NextResponse.json({ error: "未登录" }, { status: 401, headers: { "cache-control": "no-store" } });
  const { key, file } = await params;
  const imagePath = getCachedReferenceImagePath(key, file);
  if (!imagePath) return NextResponse.json({ error: "图片不存在" }, { status: 404, headers: { "cache-control": "no-store" } });
  const data = fs.readFileSync(imagePath);
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);
  return new NextResponse(bytes, {
    headers: {
      "cache-control": "private, max-age=86400",
      "content-type": imageContentType(file),
      "x-content-type-options": "nosniff",
    },
  });
}
