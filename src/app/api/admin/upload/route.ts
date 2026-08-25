import { NextResponse } from "next/server";
import crypto from "crypto";
import { promises as fsPromises } from "node:fs";
import path from "path";
import sharp from "sharp";
import { requireAdminApi } from "@/lib/auth";
import { createAttachment, getPost, type Attachment } from "@/lib/db";
import { getUploadDir } from "@/lib/uploads";
import { getClientIp, hashIp } from "@/lib/request";
import { createSlidingWindowLimiter } from "@/lib/rate-limit";
import { ALLOWED_UPLOAD_TYPES, hasSafeImageDimensions, hasValidUploadSignature, MAX_UPLOAD_REQUEST_SIZE, MAX_UPLOAD_SIZE } from "@/lib/upload-validation";
import { writeUploadWithRecord } from "@/lib/upload-storage";

export const runtime = "nodejs";

// 轻量内存限频：同一来源 60 秒内最多 30 次上传，防止会话内无限传文件打满磁盘。
// 多实例/重启后失效，仅作基础防护。
const UPLOAD_WINDOW_MS = 60 * 1000;
const UPLOAD_MAX = 30;
const allowUpload = createSlidingWindowLimiter({ windowMs: UPLOAD_WINDOW_MS, maxRequests: UPLOAD_MAX, maxKeys: 1_000 });
export async function POST(request: Request) {
  const session = await requireAdminApi(request);
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rateKey = hashIp(getClientIp(request));
  if (!allowUpload(rateKey)) {
    return NextResponse.json({ error: "上传过于频繁，请稍后再试" }, { status: 429 });
  }
  const declaredLength = Number(request.headers.get("content-length"));
  // 文件本体上限 20MB，另给 multipart 边界与字段留 1MB；先看 Content-Length，
  // 避免 request.formData() 在发现文件过大前就把整个请求缓冲进内存。
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_REQUEST_SIZE) {
    return NextResponse.json({ error: "上传请求不能超过 21MB" }, { status: 413 });
  }

  let file: File | null = null;
  let postId: number | null = null;
  let original = false;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    const rawPostId = Number(form.get("post_id"));
    if (Number.isInteger(rawPostId) && rawPostId > 0 && getPost(rawPostId)) postId = rawPostId;
    original = form.get("original") === "true";
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  const ext = ALLOWED_UPLOAD_TYPES[file.type];
  if (!ext) return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
  if (file.size > MAX_UPLOAD_SIZE) return NextResponse.json({ error: "文件不能超过 20MB" }, { status: 413 });

  // 图片默认服务端精压(转 webp + resize 上限 1920 + 质量 80);勾选原图或 gif(保动画)或非图则保留原文件
  const shouldCompress = file.type.startsWith("image/") && file.type !== "image/gif" && !original;
  let finalBuffer: Buffer = Buffer.from(await file.arrayBuffer());
  let finalExt = ext;
  let finalMime = file.type;
  // 像素炸弹防护：所有图片类型（含勾选“原图”的分支）都先按头信息校验分辨率上限。
  if (file.type.startsWith("image/")) {
    try {
      const meta = await sharp(finalBuffer).metadata();
      if (!meta.width || !meta.height || !hasValidUploadSignature(file.type, finalBuffer)) {
        return NextResponse.json({ error: "图片文件内容无效" }, { status: 400 });
      }
      if (!hasSafeImageDimensions(meta.width, meta.height)) {
        return NextResponse.json({ error: "图片分辨率过大，请压缩后上传" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "图片文件无法读取" }, { status: 400 });
    }
  }
  if (!hasValidUploadSignature(file.type, finalBuffer)) {
    return NextResponse.json({ error: "文件内容与类型不匹配" }, { status: 400 });
  }
  if (shouldCompress) {
    try {
      finalBuffer = await sharp(finalBuffer)
        .rotate()
        .resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      finalExt = ".webp";
      finalMime = "image/webp";
    } catch {
      return NextResponse.json({ error: "图片压缩失败，请更换文件后重试" }, { status: 400 });
    }
  }

  const ym = new Date().toISOString().slice(0, 7).replace("-", ""); // YYYYMM
  const name = `${crypto.randomBytes(8).toString("hex")}${finalExt}`;
  const uploadRoot = getUploadDir();
  const dir = path.join(uploadRoot, ym);
  const relativePath = `/uploads/${ym}/${name}`;
  const absolutePath = path.join(dir, name);
  // 所有上传（封面/配图/Logo/头像/附件）都入库，便于在附件管理统一查看与清理
  let attachment: Attachment;
  try {
    await fsPromises.mkdir(dir, { recursive: true });
    attachment = await writeUploadWithRecord(absolutePath, finalBuffer, () => createAttachment({
      post_id: postId,
      path: relativePath,
      original_name: file.name.slice(0, 160).replace(/[\\/\0]/g, "_") || name,
      mime_type: finalMime,
      size: finalBuffer.length,
    }));
  } catch (error) {
    console.error("[upload] 文件保存失败", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "文件保存失败，请稍后再试" }, { status: 500 });
  }
  return NextResponse.json({ path: relativePath, attachment });
}
