"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, FileText, FolderOpen, GitBranch, Home, Layers, MessageCircle, Music2, Palette, Paperclip, Settings, ShieldCheck, Tags, UserRound, type LucideIcon } from "lucide-react";

export const ADMIN_NAV: Array<{ group: string; items: Array<{ href: string; label: string; icon: LucideIcon; exact?: boolean; pending?: boolean }> }> = [
  { group: "工作台", items: [{ href: "/admin", label: "后台概览", icon: Home, exact: true }] },
  { group: "内容", items: [
    { href: "/admin/posts", label: "文章", icon: FileText },
    { href: "/admin/moments", label: "絮语", icon: MessageCircle },
    { href: "/admin/life/milestones", label: "生活节点", icon: BookOpen },
    { href: "/admin/works", label: "作品", icon: Layers },
    { href: "/admin/life/github", label: "GitHub", icon: GitBranch },
    { href: "/admin/references", label: "收藏引用", icon: FolderOpen },
    { href: "/admin/categories", label: "分类与标签", icon: Tags },
    { href: "/admin/attachments", label: "附件管理", icon: Paperclip },
  ] },
  { group: "互动", items: [{ href: "/admin/comments", label: "评论管理", icon: MessageCircle, pending: true }] },
  { group: "设置", items: [
    { href: "/admin/settings", label: "站点设置", icon: Settings, exact: true },
    { href: "/admin/settings/music", label: "音乐设置", icon: Music2 },
    { href: "/admin/settings/appearance", label: "外观主题", icon: Palette },
    { href: "/admin/settings/backups", label: "备份恢复", icon: ShieldCheck },
    { href: "/admin/pages/about", label: "关于页面", icon: UserRound },
  ] },
];

export function adminLocation(pathname: string) {
  for (const group of ADMIN_NAV) {
    const item = group.items.find(item => item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`));
    if (item) return { group: group.group, label: item.label };
  }
  return { group: "工作台", label: "后台管理" };
}

export function AdminNav({ pendingCount = 0, collapsed = false, onNavigate }: { pendingCount?: number; collapsed?: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <nav className="admin-side-nav" aria-label="后台导航">
    {ADMIN_NAV.map(group => <div className="admin-side-group" key={group.group}>
      <p className={collapsed ? "sr-only" : "admin-side-group-title"}>{group.group}</p>
      {group.items.map(({ icon: Icon, ...item }) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return <Link key={item.href} href={item.href} title={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined} onClick={onNavigate} className={`admin-side-link${active ? " is-active" : ""}`}>
          <Icon size={18} aria-hidden="true" /><span className={collapsed ? "sr-only" : "admin-side-label"}>{item.label}</span>
          {item.pending && pendingCount > 0 && <span className="admin-nav-count" aria-label={`${pendingCount} 条待审评论`}>{pendingCount > 99 ? "99+" : pendingCount}</span>}
        </Link>;
      })}
    </div>)}
  </nav>;
}
