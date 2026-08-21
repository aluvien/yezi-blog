"use server";

import crypto from "node:crypto";
import fs from "fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { requireAdmin } from "@/lib/auth";
import { deleteAttachment, listAttachments, updateAttachmentSize } from "@/lib/db";
import { uploadAbsolutePath } from "@/lib/uploads";
import type { ActionResult } from "@/lib/actions/posts";

export type CompressionProfile = "balanced" | "quality" | "small";

const COMPRESSION_QUALITY: Record<CompressionProfile, number> = {
  balanced: 80,
  quality: 90,
  small: 65,
};
const MAX_IMAGE_PIXELS = 60 * 1024 * 1024;

function removeAttachmentFile(relativePath: string): void {
  const target = uploadAbsolutePath(relativePath);
  if (target && fs.existsSync(target)) fs.unlinkSync(target);
}

function revalidateAttachmentPages() {
  revalidatePath("/admin");
  revalidatePath("/admin/attachments");
  revalidatePath("/admin/posts");
}

export async function deleteAttachmentAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  const usage = listAttachments().find((attachment) => attachment.id === id);
  if (!usage) return { ok: false, error: "附件不存在" };
  if (usage.referenced) return { ok: false, error: "附件正在文章中使用，请先移除引用" };
  const attachment = deleteAttachment(id);
  if (!attachment) return { ok: false, error: "附件不存在" };
  removeAttachmentFile(attachment.path);
  revalidateAttachmentPages();
  return { ok: true };
}

export async function deleteUntrackedAttachmentAction(relativePath: string): Promise<ActionResult> {
  await requireAdmin();
  const usage = listAttachments().find((attachment) => attachment.path === relativePath);
  if (!usage || usage.tracked) return { ok: false, error: "目录附件不存在" };
  if (usage.referenced) return { ok: false, error: "附件正在网站中使用，请先移除引用" };
  removeAttachmentFile(usage.path);
  revalidateAttachmentPages();
  return { ok: true, data: { path: usage.path, deletedCount: 1, skippedCount: 0 } };
}

export async function clearUnusedAttachmentsAction(): Promise<ActionResult> {
  await requireAdmin();
  const unused = listAttachments().filter((attachment) => !attachment.referenced);
  let deletedCount = 0;
  let skippedCount = 0;
  for (const attachment of unused) {
    if (attachment.tracked) {
      const deleted = deleteAttachment(attachment.id);
      if (deleted) {
        removeAttachmentFile(deleted.path);
        deletedCount += 1;
      } else {
        skippedCount += 1;
      }
    } else {
      removeAttachmentFile(attachment.path);
      deletedCount += 1;
    }
  }
  revalidateAttachmentPages();
  return { ok: true, data: { deletedCount, skippedCount } };
}

async function compressImageFile(relativePath: string, profile: CompressionProfile, attachmentId?: number): Promise<ActionResult> {
  const absolutePath = uploadAbsolutePath(relativePath);
  if (!absolutePath) return { ok: false, error: "附件路径无效" };
  if (!fs.existsSync(absolutePath)) return { ok: false, error: "图片文件不存在，请确认上传目录与数据库使用的是同一份数据" };

  let originalSize = 0;
  let format: string | undefined;
  let pages = 1;
  try {
    const stat = await fsPromises.stat(absolutePath);
    if (!stat.isFile()) return { ok: false, error: "附件不是文件" };
    originalSize = stat.size;
    const metadata = await sharp(absolutePath, { limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    format = metadata.format;
    pages = metadata.pages ?? 1;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EACCES" || code === "EPERM") return { ok: false, error: "图片无法读取，请检查上传目录权限" };
    return { ok: false, error: "图片无法读取，可能文件已损坏或分辨率超过 60MP" };
  }

  if (!format || !["jpeg", "png", "webp"].includes(format)) {
    return { ok: false, error: "目前仅支持 JPG、PNG、WebP 图片压缩，GIF/动图暂不处理" };
  }
  if (pages > 1) return { ok: false, error: "检测到动图，为避免丢失动画暂不压缩" };

  const quality = COMPRESSION_QUALITY[profile];
  const temporaryPath = `${absolutePath}.compressing-${crypto.randomBytes(6).toString("hex")}${path.extname(absolutePath) || ".tmp"}`;
  try {
    let pipeline = sharp(absolutePath, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
    if (format === "jpeg") {
      pipeline = pipeline.jpeg({ quality, mozjpeg: true, progressive: true });
    } else if (format === "png") {
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true, palette: profile === "small" });
    } else {
      pipeline = pipeline.webp({ quality, effort: 6 });
    }
    await pipeline.toFile(temporaryPath);
    const compressedSize = (await fsPromises.stat(temporaryPath)).size;
    if (compressedSize >= originalSize) {
      await fsPromises.unlink(temporaryPath).catch(() => undefined);
      return {
        ok: true,
        message: "压缩后体积没有变小，已保留原图",
        data: { originalSize, compressedSize: originalSize, savedPercent: 0, changed: false },
      };
    }

    await fsPromises.rename(temporaryPath, absolutePath);
    if (attachmentId) updateAttachmentSize(attachmentId, compressedSize);
    const savedPercent = Math.max(1, Math.round((1 - compressedSize / originalSize) * 100));
    revalidateAttachmentPages();
    return {
      ok: true,
      message: `压缩完成，体积减少约 ${savedPercent}%；原链接保持不变`,
      data: { originalSize, compressedSize, savedPercent, changed: true },
    };
  } catch (error) {
    await fsPromises.unlink(temporaryPath).catch(() => undefined);
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "EACCES" || code === "EPERM") return { ok: false, error: "图片压缩失败，请检查上传目录写入权限" };
    return { ok: false, error: "图片压缩失败，原图未被修改" };
  }
}

export async function compressAttachmentAction(id: number, profile: CompressionProfile = "balanced"): Promise<ActionResult> {
  await requireAdmin();
  const attachment = listAttachments().find((item) => item.id === id && item.tracked);
  if (!attachment) return { ok: false, error: "附件不存在" };
  if (!Object.prototype.hasOwnProperty.call(COMPRESSION_QUALITY, profile)) return { ok: false, error: "压缩级别无效" };
  return compressImageFile(attachment.path, profile, attachment.id);
}

export async function compressUntrackedAttachmentAction(relativePath: string, profile: CompressionProfile = "balanced"): Promise<ActionResult> {
  await requireAdmin();
  const attachment = listAttachments().find((item) => item.path === relativePath && !item.tracked);
  if (!attachment) return { ok: false, error: "目录中的附件不存在" };
  if (!Object.prototype.hasOwnProperty.call(COMPRESSION_QUALITY, profile)) return { ok: false, error: "压缩级别无效" };
  return compressImageFile(attachment.path, profile);
}
