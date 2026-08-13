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
 * 解析作者头像 URL：自定义上传 >（明确开启时）Gravatar > 本地生成头像。
 * Gravatar 默认关闭，避免把邮箱哈希发送给第三方服务。
 */
export function getAuthorAvatar(siteSettings: Record<string, string>): string | null {
  return getConfiguredAuthorAvatar(siteSettings) ?? generatedAvatar(`author:${(siteSettings.author_name?.trim().toLowerCase() || "yezi")}`);
}

/** 返回可安全作为远程封面/图片地址的配置头像；不返回本地 data URI 生成头像。 */
export function getConfiguredAuthorAvatar(siteSettings: Record<string, string>): string | null {
  const custom = siteSettings.author_avatar?.trim();
  if (custom && (custom.startsWith("/uploads/") || /^https:\/\//i.test(custom))) return custom;
  if (siteSettings.gravatar_enabled === "1") return gravatarAvatar(siteSettings.author_email ?? "", siteSettings);
  return null;
}

/** 评论头像默认只使用本地稳定头像；站点明确开启 Gravatar 后才会发送邮箱哈希。 */
export function getCommentAvatar(comment: { id: number; nickname: string; email: string | null }, siteSettings: Record<string, string>): string {
  if (siteSettings.gravatar_enabled === "1") {
    const remote = gravatarAvatar(comment.email ?? "", siteSettings);
    if (remote) return remote;
  }
  return generatedAvatar(`comment:${comment.id}:${comment.nickname.trim().toLowerCase()}`);
}
