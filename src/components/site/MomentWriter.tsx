"use client";

import { useState } from "react";
import MomentForm from "@/components/admin/MomentForm";

/** 前台想法页顶部：紧凑标题行（想法 + 记录数 + 写想法按钮），点击展开内联编辑器。 */
export function MomentWriter({ count, isAuthorized }: { count: number; isAuthorized: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-7">
      <div className="flex items-center justify-between gap-4 border-b border-divider pb-4">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground">想法</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted">{count} 条记录</span>
          {isAuthorized && (
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="rounded-md border border-divider bg-paper px-3 py-1 text-sm text-foreground transition-colors hover:bg-soft"
            >
              {open ? "收起" : "写想法"}
            </button>
          )}
        </div>
      </div>
      {open && isAuthorized && (
        <div className="mt-4 rounded-2xl border border-divider bg-paper p-4 shadow-sm">
          <MomentForm compact onSuccess={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
