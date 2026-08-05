import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import sharp from "sharp";
import { requireAdminApi } from "@/lib/auth";
import { createAttachment, getPost } from "@/lib/db";
import { getUploadDir } from "@/lib/uploads";
import { getClientIp, hashIp } from "@/lib/request";

export const runtime = "nodejs";

const MAX_SIZE = 20 * 1024 * 1024; // 20MB
// 图片分辨率上限：仅按头信息检查宽高，不触发完整解码，拦截“像素炸弹”防打满内存。
// 60MP 足够容纳常见相机原图（约 24-45MP），同时挡住超高分辨率压缩炸弹。
const MAX_PIXELS = 60 * 1024 * 1024;
// 轻量内存限频：同一来源 60 秒内最多 30 次上传，防止会话内无限传文件打满磁盘。
// 多实例/重启后失效，仅作基础防护。
const UPLOAD_WINDOW_MS = 60 * 1000;
const UPLOAD_MAX = 30;
const uploadHits = new Map<string, number[]>();
function allowUpload(key: string): boolean {
  const ts = Date.now();
  const cutoff = ts - UPLOAD_WINDOW_MS;
  const hits = (uploadHits.get(key) ?? []).filter((t) => t > cutoff);
  if (hits.length === 0) uploadHits.delete(key);
  if (hits.length >= UPLOAD_MAX) {
    uploadHits.set(key, hits);
    return false;
  }
  hits.push(ts);
  uploadHits.set(key, hits);
  return true;
}
const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/markdown": ".md",
  "application/zip": ".zip",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
};

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "未登录" }, { status: 401 });
  const rateKey = hashIp(getClientIp(request));
  if (!allowUpload(rateKey)) {
    return NextResponse.json({ error: "上传过于频繁，请稍后再试" }, { status: 429 });
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
  const ext = ALLOWED[file.type];
  if (!ext) return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "文件不能超过 20MB" }, { status: 400 });

  // 图片默认服务端精压(转 webp + resize 上限 1920 + 质量 80);勾选原图或 gif(保动画)或非图则保留原文件
  const shouldCompress = file.type.startsWith("image/") && file.type !== "image/gif" && !original;
  let finalBuffer: Buffer = Buffer.from(await file.arrayBuffer());
  let finalExt = ext;
  let finalMime = file.type;
  // 像素炸弹防护：所有图片类型（含勾选“原图”的分支）都先按头信息校验分辨率上限。
  if (file.type.startsWith("image/")) {
    try {
      const meta = await sharp(finalBuffer).metadata();
      const pixels = (meta.width ?? 0) * (meta.height ?? 0);
      if (pixels > MAX_PIXELS) {
        return NextResponse.json({ error: "图片分辨率过大，请压缩后上传" }, { status: 400 });
      }
    } catch {
      // 无法读取头信息的图片交给下方压缩分支或落盘逻辑处理，这里不强拦。
    }
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
      // sharp 处理失败则保留原图
    }
  }

  const ym = new Date().toISOString().slice(0, 7).replace("-", ""); // YYYYMM
  const name = `${crypto.randomBytes(8).toString("hex")}${finalExt}`;
  const uploadRoot = getUploadDir();
  const dir = path.join(uploadRoot, ym);
  fs.mkdirSync(dir, { recursive: true });
  const relativePath = `/uploads/${ym}/${name}`;
  const absolutePath = path.join(dir, name);
  fs.writeFileSync(absolutePath, finalBuffer);

  // 所有上传（封面/配图/Logo/头像/附件）都入库，便于在附件管理统一查看与清理
  try {
    const attachment = createAttachment({
      post_id: postId,
      path: relativePath,
      original_name: file.name.slice(0, 160).replace(/[\\/\0]/g, "_") || name,
      mime_type: finalMime,
      size: finalBuffer.length,
    });
    return NextResponse.json({ path: relativePath, attachment });
  } catch (error) {
    fs.unlinkSync(absolutePath);
    throw error;
  }
}
