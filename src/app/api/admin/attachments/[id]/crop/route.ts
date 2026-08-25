import { NextResponse } from "next/server";
import crypto from "crypto";
import { promises as fsPromises } from "node:fs";
import path from "path";
import sharp from "sharp";
import { requireAdminApi } from "@/lib/auth";
import { createAttachment, getAttachment } from "@/lib/db";
import { getUploadDir, uploadAbsolutePath } from "@/lib/uploads";
import { readLimitedJson, RequestBodyError } from "@/lib/request";
import { writeUploadWithRecord } from "@/lib/upload-storage";

export const runtime = "nodejs";

/** 按选区裁切图片,另存为新附件(保留原图)。 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminApi(request);
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });

  const { id } = await params;
  const attachment = getAttachment(Number(id));
  if (!attachment) return NextResponse.json({ error: "附件不存在" }, { status: 404 });
  if (!attachment.mime_type.startsWith("image/")) {
    return NextResponse.json({ error: "非图片不可裁切" }, { status: 400 });
  }

  let body: { x?: number; y?: number; width?: number; height?: number };
  try {
    body = await readLimitedJson(request, 4 * 1024);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求格式错误" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const values = [body.x, body.y, body.width, body.height];
  if (values.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return NextResponse.json({ error: "裁切区域无效" }, { status: 400 });
  }
  const x = Math.max(0, Math.round(body.x as number));
  const y = Math.max(0, Math.round(body.y as number));
  const width = Math.round(body.width as number);
  const height = Math.round(body.height as number);
  if (width <= 0 || height <= 0) return NextResponse.json({ error: "裁切区域无效" }, { status: 400 });

  const absPath = uploadAbsolutePath(attachment.path);
  if (!absPath) return NextResponse.json({ error: "源文件不存在" }, { status: 404 });

  try {
    await fsPromises.access(absPath);
  } catch {
    return NextResponse.json({ error: "源文件不存在" }, { status: 404 });
  }

  try {
    const metadata = await sharp(absPath).metadata();
    const imageWidth = metadata.width ?? 0;
    const imageHeight = metadata.height ?? 0;
    if (!imageWidth || !imageHeight || x + width > imageWidth || y + height > imageHeight) {
      return NextResponse.json({ error: "裁切区域超出图片范围" }, { status: 400 });
    }
    const cropped = await sharp(absPath)
      .extract({ left: x, top: y, width, height })
      .webp({ quality: 85 })
      .toBuffer();
    const ym = new Date().toISOString().slice(0, 7).replace("-", "");
    const name = `${crypto.randomBytes(8).toString("hex")}.webp`;
    const dir = path.join(getUploadDir(), ym);
    await fsPromises.mkdir(dir, { recursive: true });
    const relativePath = `/uploads/${ym}/${name}`;
    const absolutePath = path.join(dir, name);
    const newAttachment = await writeUploadWithRecord(absolutePath, cropped, () => createAttachment({
        post_id: attachment.post_id,
        path: relativePath,
        original_name: `crop-${attachment.original_name}`.slice(0, 160),
        mime_type: "image/webp",
        size: cropped.length,
      }));
    return NextResponse.json({ attachment: newAttachment });
  } catch {
    return NextResponse.json({ error: "裁切失败,请检查选区是否超出图片范围" }, { status: 500 });
  }
}
