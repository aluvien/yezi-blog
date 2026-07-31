"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "首页" },
  { href: "/moments", label: "想法" },
  { href: "/works", label: "作品" },
  { href: "/about", label: "关于" },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname.startsWith(href);
}

function TabIcon({ href, active }: { href: string; active: boolean }) {
  const cls = "h-5 w-5";
  const common = {
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: active ? 2 : 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    viewBox: "0 0 24 24",
    className: cls,
  };
  switch (href) {
    case "/":
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </svg>
      );
    case "/moments":
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H4l2-3a8 8 0 1 1 15-5Z" />
        </svg>
      );
    case "/works":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" />
        </svg>
      );
  }
}

/** 桌面端顶部导航 */
export function TopNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="主导航" className="hidden items-center gap-1 md:flex">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`rounded-full px-4 py-2 text-[14px] transition-colors ${
            isActive(pathname, item.href)
              ? "bg-accent/10 font-medium text-accent"
              : "text-foreground/65 hover:bg-neutral-100 hover:text-foreground"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

/** 移动端底部 tab 导航 */
export function BottomTabNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="移动端主导航" className="fixed inset-x-0 bottom-0 z-40 border-t border-divider bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <div className="grid grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[11px] ${
                active ? "text-accent" : "text-muted"
              }`}
            >
              <TabIcon href={item.href} active={active} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
