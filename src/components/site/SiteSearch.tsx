"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

export function SiteSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = query.trim();
    router.push(value ? `/search?q=${encodeURIComponent(value)}` : "/search");
    setOpen(false);
  }

  return (
    <div className="site-search">
      <button
        type="button"
        aria-label={open ? "关闭搜索" : "打开搜索"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="site-search-trigger"
      >
        <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 512 512" fill="currentColor">
          <path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376C296.3 401.1 253.9 416 208 416 93.1 416 0 322.9 0 208S93.1 0 208 0s208 93.1 208 208zM208 352a144 144 0 1 0 0-288 144 144 0 0 0 0 288z" />
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
