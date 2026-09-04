"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { getSiteAuthor, site, parseSocialLinks } from "@/lib/site";
import { CLASSIC_NAV_ITEMS, PUBLIC_ROUTES, getVisibleNavItems, isPublicNavActive, isPublicPostDetailPath, PWA_NAV_ITEMS } from "@/lib/site-navigation";
import { NavIcon } from "@/components/site/NavIcon";
import { SiteSearch } from "@/components/site/SiteSearch";
import { ReadingProgress } from "@/components/site/ReadingProgress";
import { MusicInitializer } from "@/components/site/MusicInitializer";
import { CodeCopyInitializer } from "@/components/site/CodeCopyInitializer";
import { SiteArticleReferenceInitializer } from "@/components/site/SiteArticleReferenceInitializer";
import { GlobalMusicPlayer } from "@/components/site/GlobalMusicPlayer";
import { ErrorBoundary } from "@/components/site/ErrorBoundary";
import { SiteImage } from "@/components/site/SiteImage";
import { NavigationFeedback } from "@/components/site/NavigationFeedback";
import { SiteScrollManager } from "@/components/site/SiteScrollManager";
import { ClassicReaderToggle } from "@/components/site/ClassicReaderToggle";
import { ClassicShell } from "@/components/site/ClassicShell";

export function SiteLayoutInner({ children, sidebarData, siteSettings = {}, categories = [], tags = [], classicSidebarIntroHtml = "" }: { children: React.ReactNode; sidebarData?: React.ReactNode; siteSettings?: Record<string, string>; categories?: Array<{ id: number; name: string; slug: string }>; tags?: Array<{ tag: string; count: number }>; classicSidebarIntroHtml?: string }) {
  const pathname = usePathname();
  const isHome = pathname === "/";
  const isPost = isPublicPostDetailPath(pathname);
  const [menuState, setMenuState] = useState<{ pathname: string; open: boolean }>({ pathname, open: false });
  const menuOpen = menuState.pathname === pathname && menuState.open;
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuDialogRef = useRef<HTMLDialogElement>(null);
  const drawerRef = useRef<HTMLElement>(null);

  // 状态绑定当前路径；布局在客户端路由间常驻时，新路径自然视为关闭，
  // 无需在 Effect 里同步 setState，也不会让返回/前进留下旧抽屉。
  const setMenuOpen = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setMenuState((current) => {
      const currentOpen = current.pathname === pathname && current.open;
      return { pathname, open: typeof next === "function" ? next(currentOpen) : next };
    });
  }, [pathname]);

  // 原生 <dialog>.showModal() 提供焦点陷阱、背景 inert 与关闭时的焦点归还；
  // 组件只负责同步开关状态，Escape 与背景点击不再手写。
  useEffect(() => {
    const dialog = menuDialogRef.current;
    if (!dialog) return;
    if (!menuOpen) {
      if (dialog.open) dialog.close();
      return;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (!dialog.open) dialog.showModal();
    drawerRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  // 主题由 <html data-theme> 驱动（RootLayout 内联脚本在首帧前设置）。
  // 按钮图标用 CSS 按 data-theme 显隐，服务端与客户端渲染永远一致，避免水合错位。
  // 未手动切换（无 theme_mode cookie）时跟随系统偏好变化。
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (!document.cookie.includes("theme_mode=")) {
        document.documentElement.setAttribute("data-theme", media.matches ? "dark" : "light");
      }
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") === "dark";
    const next = !current;
    document.documentElement.setAttribute("data-theme", next ? "dark" : "light");
    document.cookie = `theme_mode=${next ? "dark" : "light"}; path=/; max-age=31536000; samesite=lax`;
  }
  const siteName = siteSettings.site_name?.trim() || site.name;
  const authorName = getSiteAuthor(siteSettings);
  const siteSubtitle = siteSettings.site_subtitle?.trim() || "文章 · 絮语 · 作品";
  const siteLogo = siteSettings.site_logo?.trim();
  const hideSiteLogoBorder = siteSettings.site_logo_no_border === "1";
  const footerText = siteSettings.footer_text?.trim() || "认真写字，也认真生活。";
  const socialLinks = parseSocialLinks(siteSettings.social_links, 6);
  const navItems = getVisibleNavItems(siteSettings);
  const renderedNavItems = siteSettings.layout_theme === "classic" ? CLASSIC_NAV_ITEMS : navItems;
  const pwaNavItems = PWA_NAV_ITEMS.filter((item) => siteSettings[item.settingKey] !== "0");

  if (siteSettings.layout_theme === "classic") {
    return (
      <>
        <ClassicShell siteSettings={siteSettings} sidebarIntroHtml={classicSidebarIntroHtml}>{children}</ClassicShell>
        <ErrorBoundary label="MusicInitializer">
          <MusicInitializer />
        </ErrorBoundary>
        <CodeCopyInitializer />
        <SiteArticleReferenceInitializer />
        <ErrorBoundary label="GlobalMusicPlayer">
          <GlobalMusicPlayer
            defaultMusic={siteSettings.default_music?.trim()}
            defaultMusicShuffle={siteSettings.default_music_shuffle === "1"}
            musicFloatEnabled={siteSettings.music_float_enabled !== "0"}
            musicFloatInfoEnabled={siteSettings.music_float_info_enabled !== "0"}
            musicPosition={siteSettings.music_position}
            fallbackCover={siteSettings.site_logo?.trim()}
          />
        </ErrorBoundary>
      </>
    );
  }

  return (
    <div className="site-canvas flex min-h-full flex-1 flex-col">
      <div className="site-frame">
        <Suspense fallback={null}>
          <NavigationFeedback />
        </Suspense>
        <Suspense fallback={null}>
          <SiteScrollManager />
        </Suspense>
        <header className="site-frame-header">
          <Link href="/" className="site-brand-link group flex min-w-0 items-center gap-3">
            {siteLogo ? (
              <span className={`site-brand-logo relative h-10 w-10 shrink-0 overflow-hidden rounded-[4px] bg-transparent ${hideSiteLogoBorder ? "border-0" : "border border-divider"}`}>
                <SiteImage src={siteLogo} alt="" fill sizes="40px" className="object-contain" priority />
              </span>
            ) : <span className="site-brand-logo flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] border border-foreground bg-foreground text-[16px] font-bold text-white transition-colors group-hover:border-accent group-hover:bg-accent">{authorName.charAt(0).toUpperCase()}</span>}
            <span className="site-brand-copy min-w-0">
              <span className="site-brand-name block truncate text-[15px] font-semibold leading-none tracking-tight">{siteName}</span>
              <span className="site-brand-subtitle mt-1 block truncate text-[10px] leading-none tracking-[0.12em] text-muted">{siteSubtitle}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <nav className="hidden items-center gap-0.5 md:flex" aria-label="主导航">
              {renderedNavItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`site-primary-nav-link inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors ${
                    isPublicNavActive(pathname, item.section) ? "text-accent" : "text-muted hover:text-foreground"
                  }`}
                >
                  <NavIcon href={item.href} />
                  <span>{item.label}</span>
                </Link>
              ))}
            </nav>
            {siteSettings.layout_theme === "classic" && <ClassicReaderToggle />}
            {siteSettings.layout_theme === "classic" && (
              <Link href={PUBLIC_ROUTES.rss} className="classic-rss-link" aria-label="RSS" title="RSS">
                <svg className="classic-action-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                  <path strokeLinecap="round" d="M5 5.5a13.5 13.5 0 0 1 13.5 13.5M5 11a8 8 0 0 1 8 8" />
                  <circle cx="5.5" cy="18.5" r="1" fill="currentColor" stroke="none" />
                </svg>
              </Link>
            )}
            {isHome ? <SiteSearch /> : null}
            {/* 深色模式切换：仅桌面显示，位于搜索图标右侧（需求 F3） */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="切换深浅色主题"
              title="切换深浅色主题"
              className="site-theme-toggle site-header-icon-button hidden h-9 w-9 items-center justify-center rounded-[4px] border border-divider text-muted transition-colors hover:border-accent hover:text-accent md:flex"
            >
              {/* 两个图标都渲染，由 data-theme 决定显隐，避免水合内容不一致 */}
              <svg className="h-4 w-4 [html[data-theme='dark']_&]:hidden" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="4.5" />
                <path strokeLinecap="round" d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
              </svg>
              <svg className="hidden h-4 w-4 [html[data-theme='dark']_&]:block" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />
              </svg>
            </button>
            <button
              ref={menuTriggerRef}
              type="button"
              aria-label={menuOpen ? "关闭菜单" : "打开菜单"}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
              className="site-menu-trigger flex h-9 w-9 items-center justify-center rounded-[4px] border border-divider text-muted transition-colors hover:border-accent hover:text-accent md:hidden"
            >
              {menuOpen ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" /></svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" d="M5 7h14M5 12h14M5 17h14" /></svg>
              )}
            </button>
          </div>
          {isPost && <ReadingProgress />}
        </header>

        <div className={`site-frame-body ${isPost ? "site-frame-body-post" : ""}`}>
          <main className={`site-main w-full flex-1 ${isPost ? "px-2.5 pb-6 md:px-10 md:pb-8 md:pt-6" : "px-4 pb-8 md:px-6 md:pb-16"}`}>
            {children}
          </main>
          <aside className="site-sidebar hidden min-[820px]:block" aria-label="站点菜单">
              {sidebarData}
              <div className="site-sidebar-card">
                <p className="site-sidebar-label">
                  <span className="inline-flex items-center gap-2">
                    <svg className="h-3 w-3 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 11a9 9 0 0 1 9 9" /><path d="M4 4a16 16 0 0 1 16 16" /><circle cx="5" cy="19" r="1" /></svg>
                    订阅
                  </span>
                </p>
                <div className="mt-3 space-y-2 text-[12px] leading-5 text-muted">
                  <p>文章记录完整思考，絮语保存正在发生的瞬间。</p>
                  <Link href={PUBLIC_ROUTES.rss} className="inline-flex text-wechat-blue transition-colors hover:text-accent">订阅 RSS <span className="ml-1">↗</span></Link>
                </div>
              </div>
          </aside>
        </div>
        <footer className="site-footer pb-4 md:pb-0">
          <div className="mx-auto flex w-full max-w-[960px] flex-row items-center justify-between gap-2 px-4 py-3 text-xs text-muted md:px-6">
            <span className="whitespace-nowrap">© {new Date().getFullYear()} {siteName}</span>
            <span className="whitespace-nowrap">{footerText}</span>
          </div>
        </footer>
      </div>

      <nav className="site-pwa-bottom-nav" aria-label="PWA 主导航">
        {pwaNavItems.map((item) => {
          const active = isPublicNavActive(pathname, item.section);
          return (
            <Link key={item.href} href={item.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined}>
              <NavIcon href={item.href} className="h-4 w-4" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <dialog
        ref={menuDialogRef}
        className="site-mobile-menu md:hidden"
        aria-label="移动端菜单"
        onClose={() => setMenuOpen(false)}
        onClick={(event) => {
          // 点击遮罩区域（dialog 自身，而非抽屉内容）时关闭。
          if (event.target === menuDialogRef.current) setMenuOpen(false);
        }}
      >
        <aside ref={drawerRef} tabIndex={-1} className="site-mobile-drawer outline-none">
            <div className="site-mobile-menu-head">
              <span className="site-mobile-menu-title">MENU</span>
              <button type="button" aria-label="关闭菜单" onClick={() => setMenuOpen(false)} className="flex h-9 w-9 items-center justify-center rounded-[4px] border border-divider text-muted hover:border-accent hover:text-accent">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.7" viewBox="0 0 24 24" aria-hidden="true"><path strokeLinecap="round" d="m6 6 12 12M18 6 6 18" /></svg>
              </button>
            </div>
            <section className="site-mobile-menu-card">
              <h2>◉ IN SITE</h2>
              <nav className="site-mobile-menu-grid" aria-label="站内导航">
                {renderedNavItems.map((item) => (
                  <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</Link>
                ))}
                {siteSettings.layout_theme === "classic" && <Link href={PUBLIC_ROUTES.search} onClick={() => setMenuOpen(false)}>搜索</Link>}
                <Link href={PUBLIC_ROUTES.rss} onClick={() => setMenuOpen(false)}>RSS</Link>
              </nav>
            </section>
            <section className="site-mobile-menu-card">
              <h2>⌯ SOCIAL</h2>
              <div className="site-mobile-menu-social">
                {(socialLinks.length > 0 ? socialLinks : [{ label: "关于", url: "/about" }, { label: "联系", url: "/about" }, { label: "代码", url: "/about" }]).map((item) => item.url.startsWith("/") ? (
                  <Link key={`${item.label}-${item.url}`} href={item.url} onClick={() => setMenuOpen(false)} aria-label={item.label}>{item.label.slice(0, 1)}</Link>
                ) : (
                  <a key={`${item.label}-${item.url}`} href={item.url} target="_blank" rel="noopener noreferrer" aria-label={item.label}>{item.label.slice(0, 1)}</a>
                ))}
              </div>
            </section>
            {categories.length > 0 && (
              <section className="site-mobile-menu-card">
                <h2>▰ CATEGORIES</h2>
                <div className="site-mobile-menu-chips">
                  {categories.slice(0, 16).map((category) => (
                    <Link key={category.id} href={PUBLIC_ROUTES.category(category.name)} onClick={() => setMenuOpen(false)}>{category.name}</Link>
                  ))}
                </div>
              </section>
            )}

            {tags.length > 0 && (
              <section className="site-mobile-menu-card">
                <h2># TAGS</h2>
                <div className="site-mobile-menu-chips">
                  {tags.map(({ tag, count }) => (
                    <Link key={tag} href={PUBLIC_ROUTES.tag(tag)} onClick={() => setMenuOpen(false)}>#{tag}<sup>{count}</sup></Link>
                  ))}
                </div>
              </section>
            )}
          </aside>
      </dialog>
      <ErrorBoundary label="MusicInitializer">
        <MusicInitializer />
      </ErrorBoundary>
      <CodeCopyInitializer />
      <SiteArticleReferenceInitializer />
      <ErrorBoundary label="GlobalMusicPlayer">
        <GlobalMusicPlayer
          defaultMusic={siteSettings.default_music?.trim()}
          defaultMusicShuffle={siteSettings.default_music_shuffle === "1"}
          musicFloatEnabled={siteSettings.music_float_enabled !== "0"}
          musicFloatInfoEnabled={siteSettings.music_float_info_enabled !== "0"}
          musicPosition={siteSettings.music_position}
          fallbackCover={siteSettings.site_logo?.trim()}
        />
      </ErrorBoundary>
    </div>
  );
}
