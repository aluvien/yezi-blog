import crypto from "node:crypto";
import { generatedAvatar } from "@/lib/avatar";

export const DEFAULT_GRAVATAR_MIRROR = "https://secure.gravatar.com";

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

function gravatarAvatar(email: string, siteSettings: Record<string, string>): string | null {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;
  const mirror = (siteSettings.gravatar_mirror?.trim() || DEFAULT_GRAVATAR_MIRROR).replace(/\/+$/, "");
  const root = /^https:\/\//i.test(mirror) ? mirror : DEFAULT_GRAVATAR_MIRROR;
  return `${root}/avatar/${md5(normalizedEmail)}?d=identicon&s=160`;
}

/**
 * 解析作者头像 URL：自定义上传 > Gravatar（基于 email）> null（回退首字母）。
 * 在 Server Component 内调用（用到了 node:crypto）。
 */
export function getAuthorAvatar(siteSettings: Record<string, string>): string | null {
  const custom = siteSettings.author_avatar?.trim();
  if (custom && (custom.startsWith("/uploads/") || /^https:\/\//i.test(custom))) return custom;
  return gravatarAvatar(siteSettings.author_email ?? "", siteSettings);
}

/** 评论者优先使用邮箱对应的 Gravatar；未提供邮箱时使用本地稳定随机头像。 */
export function getCommentAvatar(comment: { id: number; nickname: string; email: string | null }, siteSettings: Record<string, string>): string {
  return gravatarAvatar(comment.email ?? "", siteSettings) ?? generatedAvatar(`comment:${comment.id}:${comment.nickname.trim().toLowerCase()}`);
}
