export const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/moments", label: "想法" },
  { href: "/posts", label: "文章" },
  { href: "/references", label: "引用" },
  { href: "/works", label: "作品" },
  { href: "/about", label: "关于" },
] as const;

export function getVisibleNavItems(siteSettings: Record<string, string>) {
  if (siteSettings.show_references_page === "0") return NAV_ITEMS.filter((item) => item.href !== "/references");
  return NAV_ITEMS;
}
