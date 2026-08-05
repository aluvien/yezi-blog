import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { requireAdminApi } from "@/lib/auth";
import { createAttachment, getAttachment } from "@/lib/db";
import { getUploadDir, uploadAbsolutePath } from "@/lib/uploads";

export const runtime = "nodejs";

/** 按选区裁切图片,另存为新附件(保留原图)。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const attachment = getAttachment(Number(id));
  if (!attachment) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  if (!attachment.mime_type.startsWith("image/")) {
    return NextResponse.json({ error: "非图片不可裁切" }, { status: 400 });
  }

  let body: { x?: number; y?: number; width?: number; height?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  const x = Math.max(0, Math.round(body.x ?? 0));
  const y = Math.max(0, Math.round(body.y ?? 0));
  const width = Math.max(1, Math.round(body.width ?? 0));
  const height = Math.max(1, Math.round(body.height ?? 0));
  if (width <= 0 || height <= 0) {
    return NextResponse.json({ error: "裁切区域无效" }, { status: 400 });
  }

  const absPath = uploadAbsolutePath(attachment.path);
  if (!absPath || !fs.existsSync(absPath)) return NextResponse.json({ error: "源文件不存在" }, { status: 404 });

  try {
    const buf = fs.readFileSync(absPath);
    const cropped = await sharp(buf)
      .extract({ left: x, top: y, width, height })
      .webp({ quality: 85 })
      .toBuffer();
    const ym = new Date().toISOString().slice(0, 7).replace("-", "");
    const name = `${crypto.randomBytes(8).toString("hex")}.webp`;
    const dir = path.join(getUploadDir(), ym);
    fs.mkdirSync(dir, { recursive: true });
    const relativePath = `/uploads/${ym}/${name}`;
    fs.writeFileSync(path.join(dir, name), cropped);
    const newAttachment = createAttachment({
      post_id: attachment.post_id,
      path: relativePath,
      original_name: `crop-${attachment.original_name}`.slice(0, 160),
      mime_type: "image/webp",
      size: cropped.length,
    });
    return NextResponse.json({ attachment: newAttachment });
  } catch {
    return NextResponse.json({ error: "裁切失败,请检查选区是否超出图片范围" }, { status: 500 });
  }
}
