import { NextResponse } from "next/server";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { requireAdminApi } from "@/lib/auth";
import { createAttachment, getPost } from "@/lib/db";

export const runtime = "nodejs";

const MAX_SIZE = 20 * 1024 * 1024; // 20MB
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
  if (!session) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let file: File | null = null;
  let kind = "media";
  let postId: number | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    kind = String(form.get("kind") ?? "media");
    const rawPostId = Number(form.get("post_id"));
    if (Number.isInteger(rawPostId) && rawPostId > 0 && getPost(rawPostId)) postId = rawPostId;
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  }
  const ext = ALLOWED[file.type];
  if (!ext) {
    return NextResponse.json({ error: "不支持的文件类型" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return NextResponse.json({ error: "图片不能超过 10MB" }, { status: 400 });
  }

  const ym = new Date().toISOString().slice(0, 7).replace("-", ""); // YYYYMM
  const name = `${crypto.randomBytes(8).toString("hex")}${ext}`;
  const dir = path.join(process.cwd(), "public", "uploads", ym);
  fs.mkdirSync(dir, { recursive: true });
  const relativePath = `/uploads/${ym}/${name}`;
  const absolutePath = path.join(dir, name);
  fs.writeFileSync(absolutePath, Buffer.from(await file.arrayBuffer()));

  if (kind === "attachment") {
    try {
      const attachment = createAttachment({
        post_id: postId,
        path: relativePath,
        original_name: file.name.slice(0, 160).replace(/[\\/\0]/g, "_") || name,
        mime_type: file.type,
        size: file.size,
      });
      return NextResponse.json({ attachment });
    } catch (error) {
      fs.unlinkSync(absolutePath);
      throw error;
    }
  }

  return NextResponse.json({ path: relativePath });
}
