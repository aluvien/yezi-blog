"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Book, BookOpen, Moon, Rss, Sun } from "lucide-react";
import { SiteSearch } from "@/components/site/SiteSearch";

type ClassicShellProps = {
  children: React.ReactNode;
  siteSettings: Record<string, string>;
};

const navItems = [
  { href: "/essay", label: "随笔" },
  { href: "/bits", label: "絮语" },
  { href: "/memo", label: "小记" },
  { href: "/archive", label: "归档" },
  { href: "/about", label: "关于" },
] as const;

export function ClassicShell({ children, siteSettings }: ClassicShellProps) {
  const pathname = usePathname();
  const [readingState, setReadingState] = useState({ path: "", active: false });
  const reading = readingState.path === pathname && readingState.active;
  const siteName = siteSettings.site_name?.trim() || "Whono";
  const footerText = siteSettings.footer_text?.trim() || "认真写字，也认真生活。";
  const year = new Date().getFullYear();
  const articlePath = pathname.startsWith("/archive/") || pathname.startsWith("/essay/");
  const readerLabel = reading ? "退出阅读模式" : "阅读模式";
  const routeClass = useMemo(() => {
    if (pathname === "/") return "home";
    if (pathname.startsWith("/about")) return "about-page";
    if (pathname.startsWith("/memo")) return "memo-page";
    if (pathname.startsWith("/bits")) return "bits-page";
    if (articlePath) return "article-page immersive-page";
    if (pathname.startsWith("/archive")) return "archive-page";
    if (pathname.startsWith("/essay")) return "essay-page";
    return "";
  }, [articlePath, pathname]);

  useEffect(() => {
    const body = document.body;
    const classes = routeClass.split(/\s+/).filter(Boolean);
    body.classList.add(...classes);
    return () => body.classList.remove(...classes);
  }, [routeClass]);

  useEffect(() => {
    // Article routes are marked immersive-page so the reader can expand on
    // demand, but they must still start in normal mode. Leaving this unset
    // accidentally matched the immersive footer-hiding rule.
    if (document.body.dataset.reading !== "immersive") {
      document.body.dataset.reading = "normal";
    }
  }, [articlePath, pathname]);

  useEffect(() => {
    if (!document.documentElement.dataset.themeMode) {
      document.documentElement.dataset.themeMode = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    }
  }, []);

  function toggleTheme() {
    const root = document.documentElement;
    const dark = root.dataset.theme !== "dark";
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.themeMode = dark ? "dark" : "light";
    document.cookie = `theme_mode=${dark ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  }

  function toggleReading() {
    const body = document.body;
    const immersive = body.dataset.reading !== "immersive";
    body.dataset.reading = immersive ? "immersive" : "normal";
    setReadingState({ path: pathname, active: immersive });
  }

  return (
    <>
      <a className="skip-link" href="#content">跳到内容</a>
      <div className="shell" data-sidebar-divider="default">
      <aside id="site-sidebar" className="sidebar">
        <Link className="sidebar__title sidebar__title--site" href="/" aria-label={`${siteName} 首页`}>
          <span className="sidebar__title-text">{siteName}</span>
        </Link>

        <div className="sidebar__quote">
          A minimal Astro theme<br />
          for essays, notes, and docs.<br />
          Designed for reading,<br />
          open-source.
        </div>

        <ul className="nav sidebar-public-nav">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return <li key={item.href}><Link href={item.href} aria-current={active ? "page" : undefined}><span>{item.label}</span><span className="dot" aria-hidden="true" /></Link></li>;
          })}
        </ul>

        <div className="sidebar-actions">
          {articlePath ? (
            <button id="reader-toggle" className="icon-button reader-toggle sidebar-action--rail-hidden" type="button" aria-label={readerLabel} aria-pressed={reading} data-tooltip={readerLabel} onClick={toggleReading}>
              <BookOpen className="icon icon-book-open" strokeWidth={2} aria-hidden="true" />
              <Book className="icon icon-book-closed" strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          <div className="classic-mobile-search"><SiteSearch /></div>
          <Link className="icon-button rss-link sidebar-action--rail-hidden" href="/archive/rss.xml" aria-label="RSS 订阅" data-tooltip="RSS 订阅"><Rss className="icon" strokeWidth={2} aria-hidden="true" /></Link>
          <button id="theme-toggle" className="icon-button theme-toggle" type="button" aria-label="夜间模式" data-tooltip="夜间模式" onClick={toggleTheme}>
            <Moon className="icon icon-moon" strokeWidth={2} aria-hidden="true" />
            <Sun className="icon icon-sun" strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="divider" aria-hidden="true" />

      <main id="content" className="content" tabIndex={-1}>
        <div className="content__inner">
          {children}
          <footer className="site-footer"><span>© {year} {siteName}</span><span>{footerText || ""}</span></footer>
        </div>
      </main>
      </div>
    </>
  );
}
