/** 全站基础信息，SEO / 页头页脚共用 */
export const site = {
  name: "Aluvien's Blog",
  author: "Aluvien",
  description: "个人博客：记录文章、想法与作品。",
  url: (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
};
