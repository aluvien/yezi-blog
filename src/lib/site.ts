/** 全站基础信息，SEO / 页头页脚共用 */
export const site = {
  name: "Yezi's Blog",
  author: "Yezi",
  description: "个人博客：记录文章、想法与作品。",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3030").replace(/\/+$/, ""),
};

export interface SocialLink {
  label: string;
  url: string;
}

/** 解析站点设置里的社交链接：每行 `名称 | URL`，只接受 http/https，最多 max 条。 */
export function parseSocialLinks(raw: string | undefined, max = 6): SocialLink[] {
  return (raw ?? "")
    .split("\n")
    .map((line) => {
      const [label, url] = line.split("|").map((part) => part.trim());
      return label && url && /^https?:\/\//i.test(url) ? { label, url } : null;
    })
    .filter((item): item is SocialLink => Boolean(item))
    .slice(0, max);
}
