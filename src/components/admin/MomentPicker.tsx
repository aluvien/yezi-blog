"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export interface MomentPickerItem {
  id: number;
  created_at: string;
  excerpt: string;
  images: string[];
  tags: string[];
  extracted: boolean;
  nodeId: number | null;
}

type Filter = "all" | "pending" | "done";

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: "pending", label: "未提取" },
  { key: "done", label: "已提取" },
  { key: "all", label: "全部" },
];

export default function MomentPicker({ items }: { items: MomentPickerItem[] }) {
  const [filter, setFilter] = useState<Filter>("pending");
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const needle = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "pending" && item.extracted) return false;
      if (filter === "done" && !item.extracted) return false;
      if (!needle) return true;
      return item.excerpt.toLowerCase().includes(needle) || item.tags.some((tag) => tag.toLowerCase().includes(needle));
    });
  }, [items, filter, keyword]);

  const pendingCount = items.filter((item) => !item.extracted).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {FILTERS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setFilter(tab.key)}
              aria-pressed={filter === tab.key}
              className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${filter === tab.key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
            >
              {tab.label}{tab.key === "pending" ? `（${pendingCount}）` : ""}
            </button>
          ))}
        </div>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索内容或标签"
          aria-label="搜索絮语"
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>

      {items.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">还没有可提取的絮语。</p>}
      {items.length > 0 && filtered.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">没有符合条件的絮语。</p>}

      <ul className="flex flex-col gap-2">
        {filtered.map((item) => (
          <li key={item.id} className="admin-card admin-content-card flex flex-wrap items-start justify-between gap-3 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
            <div className="min-w-0 flex-1">
              <div className="text-xs text-neutral-400">{item.created_at.slice(0, 16).replace("T", " ")}</div>
              <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-neutral-800">{item.excerpt}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {item.images.map((src, index) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={`${src}-${index}`} src={src} alt="" className="h-12 w-12 shrink-0 rounded-md border border-neutral-200 object-cover" />
                ))}
                {item.tags.map((tag) => <span key={tag} className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">#{tag}</span>)}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
              {item.extracted ? (
                <Link href={`/admin/life/milestones/${item.nodeId}/edit`} className="admin-action-link text-sm text-neutral-500 hover:text-neutral-700">已提取节点</Link>
              ) : (
                <Link href={`/admin/life/milestones/extract/${item.id}`} className="admin-button admin-button-primary rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white active:bg-neutral-700">提取节点</Link>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
