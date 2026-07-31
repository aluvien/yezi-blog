"use client";

import { useState } from "react";

interface ArticleActionBarProps {
  commentCount: number;
}

export function ArticleActionBar({ commentCount }: ArticleActionBarProps) {
  const [copied, setCopied] = useState(false);

  function scrollToComments() {
    const el = document.getElementById("comments");
    if (el) el.scrollIntoView({ behavior: "smooth" });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-40 border-t border-divider bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:bottom-0">
      <div className="mx-auto flex h-14 w-full max-w-[960px] items-center gap-3 px-4 md:px-8">
        <button
          onClick={scrollToComments}
          aria-label="前往评论区写留言"
          className="flex h-9 flex-1 items-center rounded-full bg-neutral-100 px-4 text-left text-[13px] text-muted transition-colors hover:bg-neutral-200/70"
        >
          写留言…
        </button>
        <button
          type="button"
          onClick={copyLink}
          aria-label="复制文章链接"
          className="flex h-9 items-center gap-1 rounded-full px-2 text-muted transition-colors hover:bg-neutral-100 hover:text-accent"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 14.5 14.5 9M7.4 16.6l-1.2 1.2a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M16.6 7.4l1.2-1.2a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0" />
          </svg>
          {copied && <span className="text-[11px] text-accent">已复制</span>}
        </button>
        <button
          onClick={scrollToComments}
          aria-label="查看评论"
          className="flex h-9 items-center gap-1 rounded-full px-2 text-muted transition-colors hover:bg-neutral-100 hover:text-accent"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 20.25c4.97 0 9-3.185 9-7.125 0-1.567-.612-3.012-1.636-4.182C18.31 7.793 17.444 7.125 16.5 7.125c-1.155 0-2.025.87-2.025 2.025 0 .414.13.795.352 1.125.15.225.022.555-.262.555H13.5c-1.38 0-2.595.87-3.098 2.148-.262.66.225 1.38.945 1.38h1.05c.345 0 .63.285.57.63-.18 1.02-.96 1.845-1.98 2.205-.105.037-.165.135-.135.24.36 1.155 1.507 2.01 2.85 2.317.21.045.345.24.3.45-.03.18-.18.3-.36.3z"
            />
          </svg>
          {commentCount > 0 && <span className="text-[13px]">{commentCount}</span>}
        </button>
      </div>
    </div>
  );
}
