"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { AdminNav, adminLocation } from "@/components/admin/AdminNav";
import { AdminThemeToggle } from "@/components/admin/AdminThemeToggle";

export default function AdminShell({ children, host, pendingCount }: { children: ReactNode; host: string; pendingCount: number }) {
  const [collapsed, setCollapsed] = useState(false);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const location = adminLocation(pathname);
  function close() { dialog.current?.close(); }
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0, left: 0 });
    dialog.current?.close();
  }, [pathname]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const resize = () => { if (media.matches) dialog.current?.close(); };
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  const brand = <Link href="/admin" className="admin-brand" onClick={close}><span>{collapsed ? "Y" : "Yezi"}</span><small className={collapsed ? "sr-only" : ""}>网站管理</small></Link>;
  return <div className={`admin-shell admin-workspace${collapsed ? " is-collapsed" : ""}`}>
    <a className="admin-skip-link" href="#admin-content">跳转到页面内容</a>
    <aside className="admin-sidebar" aria-label="桌面导航">
      <div className="admin-brand-area">{brand}{!collapsed && <p title={host}>{host}</p>}</div>
      <AdminNav pendingCount={pendingCount} collapsed={collapsed} />
      <div className="admin-side-footer"><Link href="/" target="_blank" rel="noopener noreferrer" title="访问网站"><ArrowUpRight size={18} /><span className={collapsed ? "sr-only" : ""}>访问网站</span></Link><button type="button" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "展开侧栏" : "收起侧栏"}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button></div>
    </aside>
    <div ref={scroll} className="admin-workspace-scroll">
      <header className="admin-topbar">
        <button ref={trigger} type="button" className="admin-drawer-trigger" aria-label="打开后台菜单" aria-expanded={open} aria-controls="admin-mobile-drawer" onClick={() => { dialog.current?.showModal(); setOpen(true); }}><Menu size={22} /></button>
        <div className="admin-breadcrumb"><span>{location.group}</span><span aria-hidden="true">/</span><strong>{location.label}</strong></div>
        <div className="admin-topbar-actions"><Link href="/" target="_blank" rel="noopener noreferrer" className="admin-domain-chip" title={`访问网站 ${host}`}><span>{host}</span><ArrowUpRight size={14} /></Link><AdminThemeToggle /><span className="admin-avatar" aria-label="管理员">Y</span></div>
      </header>
      <main id="admin-content" tabIndex={-1} className="admin-main">{children}</main>
    </div>
    <dialog ref={dialog} id="admin-mobile-drawer" className="admin-mobile-drawer" aria-label="后台菜单" onKeyDown={event => {
        if (event.key !== "Tab") return;
        const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }} onClick={event => { if (event.target === event.currentTarget) close(); }} onClose={() => { setOpen(false); trigger.current?.focus(); }}>
      <div className="admin-mobile-drawer-inner">
        <div className="admin-drawer-heading"><div><Link href="/admin" className="admin-brand" onClick={close}><span>Yezi</span><small>网站管理</small></Link><p>{host}</p></div><button type="button" onClick={close} aria-label="关闭后台菜单"><X size={22} /></button></div>
        <AdminNav pendingCount={pendingCount} onNavigate={close} />
        <Link href="/" className="admin-drawer-visit" target="_blank" rel="noopener noreferrer" onClick={close}>访问网站 <ArrowUpRight size={16} /></Link>
      </div>
    </dialog>
  </div>;
}
