/** Public site navigation shared by the web shell and native API discovery. */
export const NAV_ITEMS = [
  { href: "/", label: "首页", settingKey: "show_home_page" },
  { href: "/moments", label: "想法", settingKey: "show_moments_page" },
  { href: "/posts", label: "文章", settingKey: "show_posts_page" },
  { href: "/references", label: "引用", settingKey: "show_references_page" },
  { href: "/works", label: "作品", settingKey: "show_works_page" },
  { href: "/about", label: "关于", settingKey: "show_about_page" },
] as const;

/** 安装态 PWA 使用内容优先的五项底部导航，不混入资料库等次级入口。 */
export const PWA_NAV_ITEMS = [NAV_ITEMS[0], NAV_ITEMS[2], NAV_ITEMS[1], NAV_ITEMS[4], NAV_ITEMS[5]];

export function getVisibleNavItems(siteSettings: Record<string, string>) {
  return NAV_ITEMS.filter((item) => siteSettings[item.settingKey] !== "0");
}
