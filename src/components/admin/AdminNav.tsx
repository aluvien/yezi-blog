"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV: Array<{ href: string; label: string; exact?: boolean }> = [
  { href: "/admin", label: "仪表盘", exact: true },
  { href: "/admin/posts", label: "文章" },
  { href: "/admin/moments", label: "想法" },
  { href: "/admin/comments", label: "评论" },
  { href: "/admin/works", label: "作品" },
  { href: "/admin/attachments", label: "附件" },
  { href: "/admin/settings", label: "设置" },
];

function isActive(pathname: string, href: string, exact?: boolean): boolean {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNav({ pendingCount = 0 }: { pendingCount?: number }) {
  const pathname = usePathname();
  return (
    <nav className="admin-nav flex min-w-0 flex-1 flex-wrap items-center gap-1 overflow-visible sm:flex-nowrap sm:overflow-x-auto" aria-label="后台导航">
      {NAV.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        const className = `admin-nav-link relative shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors sm:px-3 sm:text-sm ${
          active ? "bg-neutral-900 text-white" : "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-100"
        }${item.href === "/admin/attachments" ? " admin-attachments-link" : ""}`;

        return (
          <Link key={item.href} href={item.href} className={className}>
            {item.label}
            {item.href === "/admin/comments" && pendingCount > 0 && (
              <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-medium text-white">
                {pendingCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
