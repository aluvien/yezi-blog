"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const MomentForm = dynamic(() => import("@/components/admin/MomentForm"), { ssr: false });

export function ClassicBitsToolbar({ years, count, isAuthorized }: { years: string[]; count: number; isAuthorized: boolean }) {
  const [activeYear, setActiveYear] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  function applyFilter(nextQuery: string, nextYear: string) {
    const normalized = nextQuery.trim().toLocaleLowerCase();
    document.querySelectorAll<HTMLElement>("#bits-list .bit-card").forEach((card) => {
      const matchesYear = !nextYear || card.dataset.year === nextYear;
      const matchesQuery = !normalized || (card.textContent ?? "").toLocaleLowerCase().includes(normalized);
      card.hidden = !(matchesYear && matchesQuery);
    });
    const visible = [...document.querySelectorAll<HTMLElement>("#bits-list .bit-card")].filter((card) => !card.hidden).length;
    const status = document.getElementById("bits-search-status");
    if (status) status.textContent = normalized || nextYear ? `显示 ${visible} 条絮语` : "";
  }

  function chooseYear(year: string) {
    setActiveYear(year);
    applyFilter(query, year);
  }

  function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    applyFilter(query, activeYear);
  }

  return (
    <>
      <div className="bits-toolbar">
        <div className="bits-controls">
          <div className="bits-year-filter" role="group" aria-label="按年份筛选絮语">
            <span className="bits-year-filter__cursor" aria-hidden="true" />
            <button className={`bits-year-filter__item bits-year-filter__item--all ${activeYear === "" ? "is-active" : ""}`} type="button" onClick={() => chooseYear("")}>全部</button>
            {years.map((year) => <button className={`bits-year-filter__item ${activeYear === year ? "is-active" : ""}`} type="button" key={year} onClick={() => chooseYear(year)}>{year}</button>)}
          </div>
          <div className="bits-controls__actions">
            <div className="bits-controls__search-cluster">
              <form className="bits-search" role="search" onSubmit={submitSearch}>
                <label className="sr-only" htmlFor="classic-bits-search">搜索絮语</label>
                <input id="classic-bits-search" value={query} onChange={(event) => { setQuery(event.target.value); applyFilter(event.target.value, activeYear); }} type="search" placeholder="搜索：关键词 / 标签" autoComplete="off" enterKeyHint="search" />
                <div className="bits-year-select-wrap" data-empty={activeYear ? "false" : "true"} data-active={activeYear ? "true" : "false"}>
                  <label className="sr-only" htmlFor="classic-bits-year">按年份筛选絮语</label>
                  <select id="classic-bits-year" className="bits-year-select" value={activeYear} onChange={(event) => chooseYear(event.target.value)} aria-label="按年份筛选絮语">
                    <option value="">全部</option>
                    {years.map((year) => <option value={year} key={year}>{year}</option>)}
                  </select>
                </div>
                <button className="bits-search-btn" type="submit">搜索</button>
              </form>
            </div>
            {isAuthorized ? <button className="new" type="button" aria-label="碎碎念" onClick={() => setOpen((value) => !value)}><span className="new-icon" aria-hidden="true">✍</span><span className="new-label">{open ? "收起" : "碎碎念"}</span></button> : null}
          </div>
        </div>
        <div className="bits-status" id="bits-search-status" aria-live="polite">{count > 0 ? "" : "还没有絮语"}</div>
        <div className="bits-draft-load-status" id="bits-draft-load-status" />
      </div>
      {open && isAuthorized ? <div className="classic-bits-publisher"><MomentForm compact uploadEndpoint="/api/moments/upload" onSuccess={() => setOpen(false)} onCancel={() => setOpen(false)} /></div> : null}
    </>
  );
}
