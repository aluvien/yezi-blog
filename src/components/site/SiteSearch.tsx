"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function SiteSearch() {
  const router = useRouter();
  const searchRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;

    function closeWhenClickingOutside(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && searchRef.current?.contains(target)) return;
      setOpen(false);
    }

    document.addEventListener("pointerdown", closeWhenClickingOutside);
    return () => document.removeEventListener("pointerdown", closeWhenClickingOutside);
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `/search?q=${encodeURIComponent(value)}` : "/search");
    setOpen(false);
  }

  return (
    <div ref={searchRef} className="site-search">
      <button
        type="button"
        aria-label={open ? "关闭搜索" : "打开搜索"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="site-search-trigger site-header-icon-button"
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="10.8" cy="10.8" r="6.8" />
          <path d="m16 16 4.2 4.2" />
        </svg>
      </button>
      {open && (
        <div className="site-search-popover" role="dialog" aria-label="站内搜索">
          <form onSubmit={submit} className="site-search-form">
            <label htmlFor="site-search-input" className="sr-only">搜索文章和想法</label>
            <input
              id="site-search-input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索文章和想法"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
            <button type="submit">搜索</button>
          </form>
        </div>
      )}
    </div>
  );
}
