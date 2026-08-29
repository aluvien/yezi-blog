"use client";

import { useState } from "react";
import { Search } from "lucide-react";

export function ClassicEntrySearch({ label = "随笔", targetSelector = "#classic-entry-list" }: { label?: string; targetSelector?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState("");

  function filter(value: string) {
    setQuery(value);
    const needle = value.trim().toLocaleLowerCase();
    const items = [...document.querySelectorAll<HTMLElement>(`${targetSelector} [data-entry-item]`)];
    let visible = 0;
    items.forEach((item) => {
      const matches = !needle || (item.dataset.search ?? item.textContent ?? "").toLocaleLowerCase().includes(needle);
      item.hidden = !matches;
      if (matches) visible += 1;
    });
    setFeedback(needle ? `找到 ${visible} 条${label}` : "");
  }

  return (
    <div className={`entry-search${open ? " is-open" : ""}`}>
      <div className="entry-search-panel" data-entry-search-panel aria-hidden={!open}>
        <input value={query} onChange={(event) => filter(event.target.value)} placeholder="搜索：标题 / 摘要 / 标签" aria-label={`搜索${label}`} />
        <p className="entry-search-feedback" aria-live="polite">{feedback}</p>
      </div>
      <span className="entry-search-bridge" aria-hidden="true" />
      <button className="entry-search-toggle" type="button" aria-label={open ? `关闭搜索${label}` : `搜索${label}`} aria-expanded={open} onClick={() => setOpen((value) => !value)}><Search className="icon" strokeWidth={2} aria-hidden="true" /></button>
    </div>
  );
}
