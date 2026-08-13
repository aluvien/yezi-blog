"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

const NAV: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/admin", label: "仪表盘", exact: true },
  { href: "/admin/posts", label: "文章" },
  { href: "/admin/moments", label: "想法" },
];

const DATA_NAV = [
  { href: "/admin/comments", label: "评论管理", pending: true },
  { href: "/admin/attachments", label: "附件管理" },
];

const PAGE_NAV = [
  { href: "/admin/pages/about", label: "关于我" },
  { href: "/admin/works", label: "作品管理" },
  { href: "/admin/references", label: "引用管理" },
];

const SETTINGS_NAV = [
  { href: "/admin/settings", label: "站点设置", exact: true },
  { href: "/admin/settings/music", label: "音乐设置" },
  { href: "/admin/settings/appearance", label: "外观主题" },
];

type MenuKey = "data" | "pages" | "settings";

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function MenuChevron() {
  return <svg aria-hidden="true" viewBox="0 0 12 12" className="admin-nav-chevron h-3 w-3 shrink-0 fill-none stroke-current stroke-[1.6]"><path d="m3 4.5 3 3 3-3" /></svg>;
}

export function AdminNav({ pendingCount = 0 }: { pendingCount?: number }) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const [menuState, setMenuState] = useState<{ pathname: string; key: MenuKey | null }>({ pathname, key: null });
  const openMenu = menuState.pathname === pathname ? menuState.key : null;

  const setOpenMenu = useCallback((next: MenuKey | null | ((current: MenuKey | null) => MenuKey | null)) => {
    setMenuState((current) => {
      const currentKey = current.pathname === pathname ? current.key : null;
      return { pathname, key: typeof next === "function" ? next(currentKey) : next };
    });
  }, [pathname]);

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !navRef.current?.contains(event.target)) setOpenMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu(null);
    }

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [setOpenMenu]);

  function renderMenu(key: MenuKey, label: string, items: Array<{ href: string; label: string; exact?: boolean; pending?: boolean }>) {
    const active = items.some((item) => isActive(pathname, item.href, item.exact));
    const expanded = openMenu === key;
    const menuId = `admin-nav-${key}-menu`;
    return (
      <div className={`admin-nav-menu relative shrink-0${expanded ? " is-open" : ""}`}>
        <button
          type="button"
          className={`admin-nav-link admin-nav-menu-trigger flex cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:px-3 sm:text-sm ${active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-100"}`}
          aria-haspopup="menu"
          aria-expanded={expanded}
          aria-controls={menuId}
          onClick={() => setOpenMenu((current) => current === key ? null : key)}
        >
          <span>{label}</span><MenuChevron />
        </button>
        <div id={menuId} aria-hidden={!expanded} className={`admin-nav-submenu absolute left-1/2 top-[calc(100%+8px)] z-20 flex w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col gap-1 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg${expanded ? " is-visible" : ""}`} role="menu">
          {items.map((item) => {
            const itemActive = isActive(pathname, item.href, item.exact);
            return (
              <Link key={item.href} href={item.href} role="menuitem" onClick={() => setOpenMenu(null)} className={`admin-nav-submenu-link flex w-max max-w-full items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2 text-sm no-underline transition-colors ${itemActive ? "is-active bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}>
                <span>{item.label}</span>
                {item.pending && pendingCount > 0 && <span className={`inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium ${itemActive ? "bg-white/20 text-white" : "bg-amber-500 text-white"}`}>{pendingCount}</span>}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <nav ref={navRef} className="admin-nav flex min-w-0 flex-1 flex-nowrap items-center gap-1 overflow-visible" aria-label="后台导航">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        return <Link key={item.href} href={item.href} onClick={() => setOpenMenu(null)} className={`admin-nav-link relative shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:px-3 sm:text-sm ${active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-100"}`}>{item.label}</Link>;
      })}
      {renderMenu("data", "数据", DATA_NAV)}
      {renderMenu("pages", "页面", PAGE_NAV)}
      {renderMenu("settings", "设置", SETTINGS_NAV)}
    </nav>
  );
}
