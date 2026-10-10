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
    <nav aria-label="小记管理" className="admin-tabs">
      <ul className="admin-tabs-list">
        {TABS.map((tab) => {
          const active = isActive(pathname, tab.match);
          return (
            <li key={tab.href} className="shrink-0">
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className="admin-tab"
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
