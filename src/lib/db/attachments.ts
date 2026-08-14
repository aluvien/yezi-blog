// 附件 DAO + 上传目录磁盘扫描。依赖 settings（站点设置引用判断）。
import fs from "fs";
import path from "path";
import { db, now } from "./core";
import { getSiteSettings } from "./settings";
import { getUploadDir } from "@/lib/uploads";
import type { Attachment, AttachmentReference, AttachmentWithUsage } from "./types";

export function createAttachment(data: {
  path: string;
  original_name: string;
  mime_type: string;
  size: number;
  post_id?: number | null;
}): Attachment {
  const info = db
    .prepare("INSERT INTO attachments (post_id, path, original_name, mime_type, size, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(data.post_id ?? null, data.path, data.original_name, data.mime_type, data.size, now());
  return db.prepare("SELECT * FROM attachments WHERE id = ?").get(Number(info.lastInsertRowid)) as Attachment;
}

export function getAttachment(id: number): Attachment | undefined {
  return db.prepare("SELECT * FROM attachments WHERE id = ?").get(id) as Attachment | undefined;
}

export function getPostAttachments(postId: number): Attachment[] {
  return db
    .prepare("SELECT * FROM attachments WHERE post_id = ? OR path = (SELECT cover FROM posts WHERE id = ?) ORDER BY created_at DESC")
    .all(postId, postId) as Attachment[];
}

export function attachAttachmentsToPost(ids: number[], postId: number): void {
  const uniqueIds = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))].slice(0, 100);
  const transaction = db.transaction(() => {
    // 提交的附件列表是当前文章的完整状态；先解绑已移除项，避免附件管理长期显示旧关联。
    db.prepare("UPDATE attachments SET post_id = NULL WHERE post_id = ?").run(postId);
    if (uniqueIds.length === 0) return;
    const placeholders = uniqueIds.map(() => "?").join(",");
    db.prepare(`UPDATE attachments SET post_id = ? WHERE id IN (${placeholders})`).run(postId, ...uniqueIds);
  });
  transaction();
}

/** 公共封面代理只允许读取已经保存到引用库/文章引用中的远程封面。 */
export function isKnownArticleReferenceCover(coverUrl: string): boolean {
  const value = coverUrl.trim();
  if (!value) return false;
  return Boolean(db.prepare(`
    SELECT 1 FROM reference_library WHERE cover = ?
    UNION ALL
    SELECT 1 FROM article_references WHERE cover = ?
    LIMIT 1
  `).get(value, value));
}

export function listAttachments(): AttachmentWithUsage[] {
  const rows = db.prepare("SELECT * FROM attachments ORDER BY created_at DESC").all() as Attachment[];
  const posts = db
    .prepare("SELECT id, title, slug, content, cover FROM posts")
    .all() as Array<{ id: number; title: string; slug: string; content: string; cover: string | null }>;
  const moments = db
    .prepare("SELECT id, content, images FROM moments")
    .all() as Array<{ id: number; content: string; images: string }>;
  const settings = getSiteSettings();
  const tracked = rows.map((row) => {
    const references: AttachmentReference[] = [];
    for (const post of posts) {
      const inContent = Boolean(post.content && post.content.includes(row.path));
      const isCover = Boolean(post.cover && post.cover === row.path);
      if (inContent || isCover) {
        references.push({
          type: "post",
          id: post.id,
          label: post.title,
          slug: post.slug,
          usage: inContent && isCover ? "content+cover" : isCover ? "cover" : "content",
        });
      }
    }
    for (const moment of moments) {
      if (moment.images && moment.images.includes(row.path)) {
        const summary = moment.content.replace(/\s+/g, " ").trim().slice(0, 30);
        references.push({ type: "moment", id: moment.id, label: summary || "想法" });
      }
    }
    if (settings.site_logo && settings.site_logo === row.path) {
      references.push({ type: "setting", id: 0, label: "站点 Logo" });
    }
    if (settings.author_avatar && settings.author_avatar === row.path) {
      references.push({ type: "setting", id: 0, label: "作者头像" });
    }
    return { ...row, references, referenced: references.length > 0 };
  }).map((row) => ({ ...row, tracked: true }));

  const trackedPaths = new Set(rows.map((row) => row.path));
  const diskFiles = scanUploadDirectory();
  const untracked = diskFiles
    .filter((file) => !trackedPaths.has(file.path))
    .map((file) => {
      const references = findAttachmentReferences(file.path, posts, moments, settings);
      return {
        ...file,
        id: 0,
        post_id: null,
        references,
        referenced: references.length > 0,
        tracked: false,
      } satisfies AttachmentWithUsage;
    });

  return [...tracked, ...untracked].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

const UPLOAD_MIME_BY_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".zip": "application/zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

interface DiskAttachment extends Omit<Attachment, "id" | "post_id"> {
  post_id: null;
}

function findAttachmentReferences(
  attachmentPath: string,
  posts: Array<{ id: number; title: string; slug: string; content: string; cover: string | null }>,
  moments: Array<{ id: number; content: string; images: string }>,
  settings: Record<string, string>,
): AttachmentReference[] {
  const references: AttachmentReference[] = [];
  for (const post of posts) {
    const inContent = Boolean(post.content && post.content.includes(attachmentPath));
    const isCover = Boolean(post.cover && post.cover === attachmentPath);
    if (inContent || isCover) {
      references.push({
        type: "post",
        id: post.id,
        label: post.title,
        slug: post.slug,
        usage: inContent && isCover ? "content+cover" : isCover ? "cover" : "content",
      });
    }
  }
  for (const moment of moments) {
    if (moment.images && moment.images.includes(attachmentPath)) {
      const summary = moment.content.replace(/\s+/g, " ").trim().slice(0, 30);
      references.push({ type: "moment", id: moment.id, label: summary || "想法" });
    }
  }
  if (settings.site_logo && settings.site_logo === attachmentPath) {
    references.push({ type: "setting", id: 0, label: "站点 Logo" });
  }
  if (settings.author_avatar && settings.author_avatar === attachmentPath) {
    references.push({ type: "setting", id: 0, label: "作者头像" });
  }
  return references;
}

function scanUploadDirectory(): DiskAttachment[] {
  const root = getUploadDir();
  const files: DiskAttachment[] = [];

  function walk(root: string, directory: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(root, absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (!relative || relative.startsWith("..") || relative.includes("/../")) continue;
      const webPath = `/uploads/${relative}`;
      try {
        const stat = fs.statSync(absolute);
        files.push({
          post_id: null,
          path: webPath,
          original_name: path.basename(relative),
          mime_type: UPLOAD_MIME_BY_EXTENSION[path.extname(entry.name).toLowerCase()] || "application/octet-stream",
          size: stat.size,
          created_at: new Date(stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs).toISOString(),
        });
      } catch {
        // 文件可能在扫描过程中被清理，忽略本次扫描中的瞬时错误。
      }
    }
  }

  if (fs.existsSync(root)) walk(root, root);
  return files;
}

export function deleteAttachment(id: number): Attachment | undefined {
  const attachment = getAttachment(id);
  if (!attachment) return undefined;
  db.prepare("DELETE FROM attachments WHERE id = ?").run(id);
  return attachment;
}

export function updateAttachmentSize(id: number, size: number): void {
  db.prepare("UPDATE attachments SET size = ? WHERE id = ?").run(size, id);
}

/**
 * 后台仪表盘与 Telegram 概览用的附件计数。只统计数据库已入库的记录，
 * 不做磁盘扫描：listAttachments() 会递归扫描 uploads 目录并读取全部文章
 * 正文做引用匹配，计数场景没必要承担该成本；磁盘上未入库（untracked）
 * 的文件属于手动拷入的异常状态，也不应计入附件数。
 */
export function countAttachments(): number {
  return (db.prepare("SELECT COUNT(*) AS c FROM attachments").get() as { c: number }).c;
}
