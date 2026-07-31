"use client";

import { useState } from "react";

export function MomentCommentToggle({
  targetId,
  time,
  count,
  children,
}: {
  targetId: number;
  time: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `moment-comment-panel-${targetId}`;

  return (
    <>
      <div className="mt-2 flex items-center gap-x-4 text-[13px] text-muted">
        <span>{time}</span>
        {count > 0 && <span>{count} 条评论</span>}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex items-center gap-1 text-[12px] transition-colors hover:text-accent"
        >
          <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H6l-3 2 1.2-3.6A7.5 7.5 0 1 1 20 11.5Z" />
          </svg>
          <span>评论</span>
        </button>
      </div>
      {open && (
        <div id={panelId} className="mt-3 w-full rounded-xl bg-neutral-50 p-3 md:p-4">
          {children}
        </div>
      )}
    </>
  );
}
