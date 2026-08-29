"use client";

import { useState } from "react";
import type { ContentMetrics } from "@/lib/db";
import { MetricIcon } from "@/components/site/MetricIcon";
import { LikeButton } from "@/components/site/LikeButton";

export function MomentCommentToggle({
  targetId,
  count,
  metrics,
  children,
  initialLiked = false,
}: {
  targetId: number;
  count: number;
  metrics?: ContentMetrics;
  children: React.ReactNode;
  initialLiked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panelId = `moment-comment-panel-${targetId}`;

  return (
    <>
      <div className="moment-entry-meta site-meta flex items-center gap-4 text-muted">
        <LikeButton targetType="moment" targetId={targetId} initialLikes={metrics?.likes ?? 0} initialLiked={initialLiked} />
        <span className="inline-flex items-center gap-1" aria-label="浏览次数">
          <MetricIcon type="view" />
          {metrics?.views ?? 0}
        </span>
        <span className="site-meta-spacer" aria-hidden="true" />
        <button
          type="button"
          title={count > 0 ? `查看 ${count} 条评论` : "写下评论"}
          aria-label={count > 0 ? `查看 ${count} 条评论` : "写下评论"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
          className="-m-1 ml-auto inline-flex min-h-7 items-center gap-1 rounded-full px-1 transition-colors hover:bg-accent/10 hover:text-accent"
        >
          <MetricIcon type="comment" />
          <span>{count}</span>
        </button>
      </div>
      {open && (
        <div id={panelId} className="mt-3 w-full rounded-xl bg-soft p-3 md:p-4">
          {children}
        </div>
      )}
    </>
  );
}
