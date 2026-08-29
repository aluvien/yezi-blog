"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

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

  useEffect(() => {
    if (!open) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `${PUBLIC_ROUTES.search}?q=${encodeURIComponent(value)}` : PUBLIC_ROUTES.search);
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
        <Search aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
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
