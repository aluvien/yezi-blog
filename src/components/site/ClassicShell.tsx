"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Book, BookOpen, Moon, Rss, Sun } from "lucide-react";
import { SiteSearch } from "@/components/site/SiteSearch";
import { CLASSIC_NAV_ITEMS, PUBLIC_ROUTES, getPublicSection, isPublicNavActive, isPublicPostDetailPath } from "@/lib/site-navigation";

type ClassicShellProps = {
  children: React.ReactNode;
  siteSettings: Record<string, string>;
  sidebarIntroHtml?: string;
};

/* Classic layout attribution is source-only; see LICENSES/cxro-classic-theme-MIT.txt. */
export function ClassicShell({ children, siteSettings, sidebarIntroHtml = "" }: ClassicShellProps) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const [readingState, setReadingState] = useState({ path: "", active: false });
  const [urlReading, setUrlReading] = useState(false);
  // body.dataset.reading 是切页时由 effect 归一化的外部状态；一起判断可避免
  // 从沉浸页面返回后再回退时，旧的 path 状态把按钮误显示成“退出阅读模式”。
  const reading = readingState.path === pathname
    && readingState.active
    && (typeof document === "undefined" || document.body.dataset.reading === "immersive");
  const siteName = siteSettings.site_name?.trim() || "Whono";
  const footerText = siteSettings.footer_text?.trim() || "认真写字，也认真生活。";
  const year = new Date().getFullYear();
  const articlePath = isPublicPostDetailPath(pathname);
  const publicSection = getPublicSection(pathname);
  const memoPath = !articlePath && (publicSection === "life" || publicSection === "works");
  const readerAvailable = articlePath || memoPath;
  const readerLabel = reading ? "退出阅读模式" : "阅读模式";

  useEffect(() => {
    const syncUrlReading = () => {
      const params = new URLSearchParams(window.location.search);
      const value = (params.get("reading") || params.get("reader") || params.get("mode") || "").trim().toLowerCase();
      setUrlReading(["1", "true", "immersive", "reader", "reading"].includes(value));
    };
    syncUrlReading();
    window.addEventListener("popstate", syncUrlReading);
    return () => window.removeEventListener("popstate", syncUrlReading);
  }, [pathname]);
  const routeClass = useMemo(() => {
    if (articlePath) return "article-page immersive-page";
    const section = publicSection;
    if (section === "home") return "home";
    if (section === "about") return "about-page";
    // 「小记」聚合页沿用参考站的书页版式，并允许按需进入阅读模式。
    if (section === "life" || section === "works") return "memo-page immersive-page";
    if (section === "moments") return "bits-page";
    if (section === "archives") return "archive-page";
    if (section === "posts") return "essay-page";
    return "";
  }, [articlePath, publicSection]);

  useEffect(() => {
    const body = document.body;
    const classes = routeClass.split(/\s+/).filter(Boolean);
    body.classList.add(...classes);
    return () => body.classList.remove(...classes);
  }, [routeClass]);

  useEffect(() => {
    // 每次切换公开页面都回到普通模式，避免从文章/小记的沉浸状态跳转后
    // 侧栏继续隐藏；用户仍可在当前页面再次点按阅读按钮进入沉浸模式。
    const immersive = readerAvailable && urlReading;
    document.body.dataset.reading = immersive ? "immersive" : "normal";
    document.body.classList.toggle("immersive-page", immersive || articlePath || memoPath);
    const resetTimer = window.setTimeout(() => setReadingState({ path: pathname, active: immersive }), 0);
    return () => window.clearTimeout(resetTimer);
  }, [pathname, readerAvailable, urlReading, articlePath, memoPath]);

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

        {sidebarIntroHtml ? <div className="sidebar__quote classic-sidebar-markdown" dangerouslySetInnerHTML={{ __html: sidebarIntroHtml }} /> : null}

        <ul className="nav sidebar-public-nav">
          {CLASSIC_NAV_ITEMS.map((item) => {
            const active = isPublicNavActive(pathname, item.section);
            return <li key={item.href}><Link href={item.href} aria-current={active ? "page" : undefined}><span>{item.label}</span><span className="dot" aria-hidden="true" /></Link></li>;
          })}
        </ul>

        <div className="sidebar-actions">
          {readerAvailable ? (
            <button id="reader-toggle" className="icon-button reader-toggle sidebar-action--rail-hidden" type="button" aria-label={readerLabel} aria-pressed={reading} data-tooltip={readerLabel} onClick={toggleReading}>
              <BookOpen className="icon icon-book-open" strokeWidth={2} aria-hidden="true" />
              <Book className="icon icon-book-closed" strokeWidth={2} aria-hidden="true" />
            </button>
          ) : null}
          {isHome ? <div className="classic-mobile-search"><SiteSearch placeholder="搜索：标题 / 摘要 / 标签" /></div> : null}
          <Link className="icon-button rss-link sidebar-action--rail-hidden" href={PUBLIC_ROUTES.rss} aria-label="RSS 订阅" data-tooltip="RSS 订阅"><Rss className="icon" strokeWidth={2} aria-hidden="true" /></Link>
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
