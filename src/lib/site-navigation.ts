/**
 * 公开站点的规范路径。URL 只描述内容类型，不跟随版式主题变化；经典版仅
 * 改变导航文案和视觉。所有组件都应通过这里生成详情、分类与锚点链接。
 */
export const PUBLIC_ROUTES = {
  home: "/",
  posts: "/posts",
  moments: "/moments",
  works: "/works",
  archives: "/archives",
  references: "/references",
  about: "/about",
  search: "/search",
  rss: "/rss.xml",
  post: (slug: string) => `/posts/${encodeURIComponent(slug)}`,
  postComments: (slug: string) => `/posts/${encodeURIComponent(slug)}#comments`,
  moment: (id: number | string) => `/moments#moment-${encodeURIComponent(String(id))}`,
  category: (category: string) => `/categories/${encodeURIComponent(category)}`,
  tag: (tag: string) => `/tags/${encodeURIComponent(tag)}`,
} as const;

export type PublicSection = "home" | "posts" | "moments" | "works" | "archives" | "references" | "about";

type PublicNavItem = {
  href: string;
  label: string;
  section: PublicSection;
  settingKey?: string;
};

/** Public site navigation shared by the web shell and native API discovery. */
export const NAV_ITEMS = [
  { href: PUBLIC_ROUTES.home, label: "首页", section: "home", settingKey: "show_home_page" },
  { href: PUBLIC_ROUTES.moments, label: "想法", section: "moments", settingKey: "show_moments_page" },
  { href: PUBLIC_ROUTES.posts, label: "文章", section: "posts", settingKey: "show_posts_page" },
  { href: PUBLIC_ROUTES.references, label: "引用", section: "references", settingKey: "show_references_page" },
  { href: PUBLIC_ROUTES.works, label: "作品", section: "works", settingKey: "show_works_page" },
  { href: PUBLIC_ROUTES.about, label: "关于", section: "about", settingKey: "show_about_page" },
] as const satisfies readonly PublicNavItem[];

/** 经典版只替换名称，仍指向与编辑版相同的规范页面。 */
export const CLASSIC_NAV_ITEMS = [
  { href: PUBLIC_ROUTES.posts, label: "随笔", section: "posts" },
  { href: PUBLIC_ROUTES.moments, label: "絮语", section: "moments" },
  { href: PUBLIC_ROUTES.works, label: "小记", section: "works" },
  { href: PUBLIC_ROUTES.archives, label: "归档", section: "archives" },
  { href: PUBLIC_ROUTES.about, label: "关于", section: "about" },
] as const satisfies readonly PublicNavItem[];

/** 安装态 PWA 使用内容优先的五项底部导航，不混入资料库等次级入口。 */
export const PWA_NAV_ITEMS = [NAV_ITEMS[0], NAV_ITEMS[2], NAV_ITEMS[1], NAV_ITEMS[4], NAV_ITEMS[5]];

export function getVisibleNavItems(siteSettings: Record<string, string>) {
  return NAV_ITEMS.filter((item) => siteSettings[item.settingKey] !== "0");
}

/**
 * 将规范路径和历史兼容路径归入同一导航栏目。分类、标签与文章详情都属于
 * “文章/随笔”，归档详情旧地址也按文章处理，而不是误亮“归档”。
 */
export function getPublicSection(pathname: string): PublicSection | null {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (path === "/") return "home";
  if (path === "/about" || path.startsWith("/about/")) return "about";
  if (path === "/references" || path.startsWith("/references/")) return "references";
  if (path === "/moments" || path.startsWith("/moments/") || path === "/bits" || path.startsWith("/bits/")) return "moments";
  if (path === "/works" || path.startsWith("/works/") || path === "/memo" || path.startsWith("/memo/")) return "works";
  if (path === "/archives" || path.startsWith("/archives/") || path === "/archive" || path === "/archive/rss.xml") return "archives";
  if (
    path === "/posts" || path.startsWith("/posts/") ||
    path === "/essay" || path.startsWith("/essay/") ||
    path.startsWith("/archive/") || path.startsWith("/categories/") || path.startsWith("/tags/")
  ) return "posts";
  return null;
}

export function isPublicNavActive(pathname: string, section: PublicSection): boolean {
  return getPublicSection(pathname) === section;
}

export function isPublicPostDetailPath(pathname: string): boolean {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, "");
  return /^\/(?:posts|essay|archive)\/[^/]+$/.test(path) && !path.endsWith("/rss.xml");
}
