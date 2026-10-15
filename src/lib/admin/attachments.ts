import { currentDataEpoch } from "@/lib/cloud-restore-guard";
import { withDataFileMutation } from "@/lib/data-files-lock";
import { trashAttachment, restoreTrashedAttachment } from "@/lib/attachment-trash";
import crypto from "node:crypto";
import fs from "node:fs";
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { listAttachments, updateAttachmentSize } from "@/lib/db";
import { uploadAbsolutePath } from "@/lib/uploads";
import type { ActionResult } from "@/lib/actions/posts";
import type { CompressionProfile } from "@/lib/actions/attachments";

/**
 * 附件文件与数据库记录的业务核心。鉴权由调用方（Server Action 或已鉴权 Route Handler）负责。
 *
 * 文件与数据库没有共享事务，因此统一采用「先隔离、再改库、最后清理」的顺序：
 * 任何一步失败都能把文件移回原位或保留可恢复的隔离副本，不会让磁盘与数据库静默分叉。
 */

export const COMPRESSION_QUALITY: Record<CompressionProfile, number> = {
  balanced: 80,
  quality: 90,
  small: 65,
};
const MAX_IMAGE_PIXELS = 60 * 1024 * 1024;

function quarantinePath(absolutePath: string, prefix: string): string {
  // 扫描目录会跳过以 “.” 开头的文件，隔离副本不会被误认成未追踪附件。
  return path.join(path.dirname(absolutePath), `.${prefix}-${path.basename(absolutePath)}-${crypto.randomBytes(6).toString("hex")}`);
}

/** 原子移动文件到隔离路径；返回隔离路径，文件本就不存在时返回 null。 */
async function moveFileToQuarantine(absolutePath: string, prefix: string): Promise<string | null> {
  try {
    const target = quarantinePath(absolutePath, prefix);
    await fsPromises.rename(absolutePath, target);
    return target;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function restoreQuarantinedFile(quarantine: string, absolutePath: string): Promise<boolean> {
  try {
    await fsPromises.rename(quarantine, absolutePath);
    return true;
  } catch (error) {
    console.error(`[attachments] 无法把隔离文件 ${quarantine} 移回 ${absolutePath}`, error instanceof Error ? error.message : error);
    return false;
  }
}

async function discardQuarantinedFile(quarantine: string): Promise<void> {
  try {
    await fsPromises.unlink(quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      // 隔离文件以 “.” 开头，不会出现在附件列表中；残留只浪费磁盘，不会造成数据分叉。
      console.error(`[attachments] 隔离文件清理失败，稍后可手动删除：${quarantine}`, error instanceof Error ? error.message : error);
    }
  }
}

function revalidateAttachmentPages() {
  revalidatePath("/admin");
  revalidatePath("/admin/attachments");
  revalidatePath("/admin/posts");
}

async function mutate(run: () => Promise<ActionResult>, epoch: string): Promise<ActionResult> {
  try { return await withDataFileMutation(run, epoch); }
  catch (error) { return { ok: false, error: error instanceof Error ? error.message : "附件操作失败，请重试" }; }
}

export async function deleteAttachmentById(id: number, epoch = currentDataEpoch()): Promise<ActionResult> {
  return mutate(async () => {
    const usage = listAttachments().find(item => item.id === id && item.tracked);
    if (!usage) return { ok: false, error: "附件不存在" };
    await trashAttachment(usage);
    revalidateAttachmentPages();
    return { ok: true };
  }, epoch);
}

export async function deleteUntrackedAttachmentByPath(relativePath: string, epoch = currentDataEpoch()): Promise<ActionResult> {
  return mutate(async () => {
    const usage = listAttachments().find(item => item.path === relativePath && !item.tracked);
    if (!usage) return { ok: false, error: "目录附件不存在" };
    await trashAttachment(usage);
    revalidateAttachmentPages();
    return { ok: true, data: { path: usage.path, deletedCount: 1, skippedCount: 0 } };
  }, epoch);
}

export async function clearUnusedAttachments(epoch = currentDataEpoch()): Promise<ActionResult> {
  return mutate(async () => {
    const unused = listAttachments().filter(item => !item.referenced);
    let deletedCount = 0;
    let skippedCount = 0;
    for (const attachment of unused) {
      try { await trashAttachment(attachment); deletedCount += 1; }
      catch { skippedCount += 1; }
    }
    revalidateAttachmentPages();
    return { ok: true, data: { deletedCount, skippedCount } };
  }, epoch);
}

export async function restoreAttachmentFromTrash(id: string, epoch = currentDataEpoch()): Promise<ActionResult> {
  try {
    await restoreTrashedAttachment(id, epoch);
    revalidateAttachmentPages();
    return { ok: true };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "附件恢复失败" }; }
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
  let backupPath: string | null = null;
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

    // 覆盖原文件前先把原图原子移动到备份路径。此后任何失败（替换或
    // 数据库更新）都从备份恢复原图，而不是声称“原图未被修改”却已被覆盖。
    backupPath = await moveFileToQuarantine(absolutePath, "compress-backup");
    try {
      await fsPromises.rename(temporaryPath, absolutePath);
    } catch (error) {
      if (backupPath && await restoreQuarantinedFile(backupPath, absolutePath)) {
        backupPath = null;
      }
      throw error;
    }
    const originalBackup = backupPath;
    backupPath = null;
    if (attachmentId) {
      try {
        updateAttachmentSize(attachmentId, compressedSize);
      } catch (error) {
        await fsPromises.unlink(absolutePath).catch(() => undefined);
        const restored = originalBackup ? await restoreQuarantinedFile(originalBackup, absolutePath) : false;
        console.error("[attachments] 压缩后更新附件大小失败", error instanceof Error ? error.message : error);
        return {
          ok: false,
          error: restored
            ? "压缩后更新附件记录失败，原图已恢复，请重试"
            : `压缩后更新附件记录失败，且原图恢复失败；备份在 ${originalBackup ?? "（未知）"}，请人工恢复后核对附件大小`,
        };
      }
    }
    if (originalBackup) await discardQuarantinedFile(originalBackup);
    const savedPercent = Math.max(1, Math.round((1 - compressedSize / originalSize) * 100));
    revalidateAttachmentPages();
    return {
      ok: true,
      message: `压缩完成，体积减少约 ${savedPercent}%；原链接保持不变`,
      data: { originalSize, compressedSize, savedPercent, changed: true },
    };
  } catch (error) {
    await fsPromises.unlink(temporaryPath).catch(() => undefined);
    if (backupPath && await restoreQuarantinedFile(backupPath, absolutePath)) {
      backupPath = null;
    }
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    const suffix = backupPath ? `；原图备份在 ${backupPath}，请人工恢复` : "";
    if (code === "EACCES" || code === "EPERM") return { ok: false, error: `图片压缩失败，请检查上传目录写入权限${suffix}` };
    return { ok: false, error: backupPath ? `图片压缩失败，且原图恢复失败${suffix}` : "图片压缩失败，原图未被修改（或已从备份恢复）" };
  }
}

export async function compressAttachmentById(id: number, profile: CompressionProfile = "balanced", epoch = currentDataEpoch()): Promise<ActionResult> {
  return mutate(async () => {
  const attachment = listAttachments().find((item) => item.id === id && item.tracked);
  if (!attachment) return { ok: false, error: "附件不存在" };
  if (!Object.prototype.hasOwnProperty.call(COMPRESSION_QUALITY, profile)) return { ok: false, error: "压缩级别无效" };
  return compressImageFile(attachment.path, profile, attachment.id);
  }, epoch);
}

export async function compressUntrackedAttachmentByPath(relativePath: string, profile: CompressionProfile = "balanced", epoch = currentDataEpoch()): Promise<ActionResult> {
  return mutate(async () => {
  const attachment = listAttachments().find((item) => item.path === relativePath && !item.tracked);
  if (!attachment) return { ok: false, error: "目录中的附件不存在" };
  if (!Object.prototype.hasOwnProperty.call(COMPRESSION_QUALITY, profile)) return { ok: false, error: "压缩级别无效" };
  return compressImageFile(attachment.path, profile);
  }, epoch);
}
