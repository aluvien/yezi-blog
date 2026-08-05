"use client";

import { useEffect, useRef, useState } from "react";
import type { TocHeading } from "@/lib/markdown";
import { attachScrollListener } from "./scroll-utils";

export function TableOfContents({ headings }: { headings: TocHeading[] }) {
  const [activeId, setActiveId] = useState("");
  const [open, setOpen] = useState(true);
  const [mobileVisible, setMobileVisible] = useState(false);
  const mobileHideTimer = useRef<number | null>(null);

  useEffect(() => {
    const elements = headings
      .map((h) => document.getElementById(h.id))
      .filter(Boolean) as HTMLElement[];
    if (elements.length === 0) return;

    const check = () => {
      const offset = 80;
      let current = "";
      for (const el of elements) {
        if (el.getBoundingClientRect().top <= offset) {
          current = el.id;
        }
      }
      setActiveId(current);
    };

    const showMobileToc = () => {
      setMobileVisible(true);
      if (mobileHideTimer.current) window.clearTimeout(mobileHideTimer.current);
      mobileHideTimer.current = window.setTimeout(() => {
        setMobileVisible(false);
      }, 2000);
    };

    check();
    // 桌面端滚动容器是 .site-main，移动端是 window；attachScrollListener 同时监听两者。
    const cleanup = attachScrollListener(() => {
      check();
      showMobileToc();
    });
    return () => {
      cleanup();
      if (mobileHideTimer.current) window.clearTimeout(mobileHideTimer.current);
    };
  }, [headings]);

  if (headings.length === 0) return null;

  function jumpToHeading(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
    setMobileVisible(false);
  }

  const items = (
    <ul className="article-toc-items space-y-1 border-l-2 border-divider pl-3">
      {headings.map((h) => (
        <li key={h.id}>
          <a
            href={`#${h.id}`}
            onClick={(event) => jumpToHeading(event, h.id)}
            className={`block rounded-r-md py-1.5 pr-2 text-[13px] leading-5 transition-colors ${
              h.level === 3 ? "pl-3" : "pl-1"
            } ${
              activeId === h.id
                ? "bg-accent/10 font-medium text-accent"
                : "text-muted hover:bg-soft hover:text-foreground"
            }`}
          >
            {h.text}
          </a>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      <aside className="article-toc-floating" aria-label="文章目录">
        {open ? (
          <div className="overflow-hidden rounded-2xl border border-divider bg-paper/95 shadow-lg shadow-neutral-900/5 backdrop-blur">
            <div className="flex items-center justify-between border-b border-divider px-4 py-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Contents</p>
                <p className="mt-1 text-[13px] font-medium text-foreground">文章目录 <span className="font-normal text-muted">{headings.length}</span></p>
              </div>
              <button
                type="button"
                aria-label="隐藏文章目录"
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-muted transition-colors hover:bg-soft hover:text-foreground"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <nav className="max-h-[calc(100vh-220px)] overflow-y-auto px-4 py-3" aria-label="文章目录详情">
              {items}
            </nav>
          </div>
        ) : (
          <button
            type="button"
            aria-label="显示文章目录"
            aria-expanded={false}
            onClick={() => setOpen(true)}
            className="flex items-center gap-2 rounded-full border border-divider bg-paper/95 px-3 py-2 text-[12px] font-medium text-muted shadow-lg shadow-neutral-900/5 backdrop-blur transition-colors hover:text-accent"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 6.5h14M5 12h14M5 17.5h9" />
            </svg>
            目录
          </button>
        )}
      </aside>

      <aside className={`article-toc-mobile ${mobileVisible ? "is-visible" : ""}`} aria-label="移动端文章目录">
        <div className="article-toc-mobile-shell">
          <nav className="article-toc-mobile-rail" aria-label="移动端文章目录详情">
            {headings.map((h) => (
              <a
                key={h.id}
                href={`#${h.id}`}
                onClick={(event) => jumpToHeading(event, h.id)}
                aria-label={`跳转到：${h.text}`}
                aria-current={activeId === h.id ? "location" : undefined}
                className={`article-toc-mobile-marker article-toc-mobile-marker-level-${h.level} ${activeId === h.id ? "is-active" : ""}`}
              >
                <span className="article-toc-mobile-label">{h.text}</span>
                <span className="article-toc-mobile-line" aria-hidden="true" />
              </a>
            ))}
          </nav>
        </div>
      </aside>
    </>
  );
}
