"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";

const NAV: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/admin", label: "仪表盘", exact: true },
  { href: "/admin/posts", label: "文章" },
  { href: "/admin/moments", label: "想法" },
  { href: "/admin/comments", label: "评论" },
];

const DATA_NAV: Array<{ href: string; label: string }> = [
  { href: "/admin/works", label: "作品" },
  { href: "/admin/references", label: "引用" },
  { href: "/admin/attachments", label: "附件" },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ pendingCount = 0 }: { pendingCount?: number }) {
  const pathname = usePathname();
  const dataActive = DATA_NAV.some((item) => isActive(pathname, item.href));
  const dataMenuRef = useRef<HTMLDetailsElement>(null);
  function closeDataMenu() {
    dataMenuRef.current?.removeAttribute("open");
  }
  return (
    <nav className="admin-nav flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-visible sm:flex-nowrap sm:overflow-x-auto" aria-label="后台导航">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        const className = `admin-nav-link relative shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:px-3 sm:text-sm ${
          active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-100"
        }${item.href === "/admin/attachments" ? " admin-attachments-link" : ""}`;

        return (
          <Link key={item.href} href={item.href} onClick={closeDataMenu} className={className}>
            {item.label}
            {item.href === "/admin/comments" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white">
                {pendingCount}
              </span>
            )}
          </Link>
        );
      })}
      <details ref={dataMenuRef} className="admin-nav-menu group relative shrink-0">
        <summary
          className={`admin-nav-link flex cursor-pointer list-none items-center gap-1 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:px-3 sm:text-sm [&::-webkit-details-marker]:hidden ${
            dataActive ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-100"
          }`}
        >
          数据
          <span aria-hidden="true" className="text-[10px] opacity-60 transition-transform group-open:rotate-180">⌄</span>
        </summary>
        <div className="admin-nav-submenu absolute left-0 top-[calc(100%+6px)] z-20 flex min-w-24 flex-col gap-1 rounded-xl border border-neutral-200 bg-white p-1.5 shadow-lg">
          {DATA_NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeDataMenu}
                className={`rounded-lg px-3 py-2 text-sm no-underline transition-colors ${active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100"}`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </details>
      <Link
        href="/admin/settings"
        onClick={closeDataMenu}
        className={`admin-nav-link relative shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:px-3 sm:text-sm ${
          isActive(pathname, "/admin/settings") ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-100"
        }`}
      >
        设置
      </Link>
    </nav>
  );
}
