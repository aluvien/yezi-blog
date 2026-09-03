"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/life/milestones", label: "生活节点", match: ["/admin/life/milestones"] },
  { href: "/admin/works", label: "作品", match: ["/admin/works"] },
  { href: "/admin/life/github", label: "GitHub", match: ["/admin/life/github"] },
  { href: "/admin/references", label: "收藏引用", match: ["/admin/references"] },
];

function isActive(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** 小记后台的分栏导航；works/references 沿用既有路由，只把它们聚合到同一组 Tabs 下。 */
export default function LifeAdminTabs() {
  const pathname = usePathname();
  return (
    <nav aria-label="小记管理" className="-mx-1 overflow-x-auto px-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ul className="flex min-w-max items-center gap-1.5 border-b border-neutral-200 pb-2">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.match);
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`inline-block whitespace-nowrap rounded-lg px-3.5 py-2 text-sm no-underline transition-colors ${
                  active ? "bg-neutral-900 font-medium text-white" : "text-neutral-600 hover:bg-neutral-100"
                }`}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
