import crypto from "node:crypto";

export const DEFAULT_GRAVATAR_MIRROR = "https://secure.gravatar.com";

function md5(value: string): string {
  return crypto.createHash("md5").update(value).digest("hex");
}

/**
 * 解析作者头像 URL：自定义上传 > Gravatar（基于 email）> null（回退首字母）。
 * 在 Server Component 内调用（用到了 node:crypto）。
 */
export function getAuthorAvatar(siteSettings: Record<string, string>): string | null {
  const custom = siteSettings.author_avatar?.trim();
  if (custom && (custom.startsWith("/uploads/") || /^https:\/\//i.test(custom))) return custom;
  const email = siteSettings.author_email?.trim();
  if (!email) return null;
  const mirror = (siteSettings.gravatar_mirror?.trim() || DEFAULT_GRAVATAR_MIRROR).replace(/\/+$/, "");
  if (!/^https:\/\//i.test(mirror)) return DEFAULT_GRAVATAR_MIRROR + `/avatar/${md5(email.toLowerCase())}?d=identicon&s=160`;
  return `${mirror}/avatar/${md5(email.toLowerCase())}?d=identicon&s=160`;
}
