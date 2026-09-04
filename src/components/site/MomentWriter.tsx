"use client";

import { useState } from "react";
import MomentForm from "@/components/admin/MomentForm";

/** 前台絮语页顶部：紧凑标题行（絮语 + 记录数 + 写一条按钮），点击展开内联编辑器。 */
export function MomentWriter({ count, isAuthorized, classic = false }: { count: number; isAuthorized: boolean; classic?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="site-moments-header mb-7">
      <div className="site-list-heading flex items-center justify-between gap-4 border-b border-divider pb-4">
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground">絮语</h1>
          {classic && <p className="classic-page-subtitle">生活不只是长篇</p>}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{count} 条记录</span>
          {isAuthorized && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-md border border-divider bg-paper px-3 py-1 text-sm text-foreground transition-colors hover:bg-soft"
            >
              {open ? "收起" : "写一条"}
            </button>
          )}
        </div>
      </div>
      {open && isAuthorized && (
        <div className="mt-4 rounded-2xl border border-divider bg-paper p-4 shadow-sm">
          <MomentForm compact uploadEndpoint="/api/moments/upload" onSuccess={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
