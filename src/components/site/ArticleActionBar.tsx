"use client";

import { useEffect, useState } from "react";
import { MetricIcon } from "@/components/site/MetricIcon";

interface ArticleActionBarProps {
  commentCount: number;
  targetId: number;
  initialMetrics: { views: number; likes: number };
  initialLiked?: boolean;
}

export function ArticleActionBar({ commentCount, targetId, initialMetrics, initialLiked = false }: ArticleActionBarProps) {
  const [metrics, setMetrics] = useState(initialMetrics);
  // 初始点赞状态由 SSR 查后端得出，避免 localStorage 与后端不一致
  const [liked, setLiked] = useState(initialLiked);

  useEffect(() => {
    void fetch("/api/v1/interactions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target_type: "post", target_id: targetId, kind: "view" }),
    })
      .then(async (response) => {
        if (!response.ok) return;
        const payload = (await response.json().catch(() => null)) as { data?: { views: number; likes: number } } | null;
        if (payload?.data) setMetrics(payload.data);
      })
      .catch(() => undefined);
  }, [targetId]);

  async function toggleLike() {
    const wasLiked = liked;
    setLiked(!wasLiked);
    setMetrics((m) => ({ ...m, likes: Math.max(0, m.likes + (wasLiked ? -1 : 1)) }));
    try {
      const response = await fetch("/api/v1/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: "post", target_id: targetId, kind: "like" }),
      });
      if (!response.ok) throw new Error("like failed");
      const payload = (await response.json().catch(() => null)) as { data?: { views: number; likes: number; liked?: boolean } } | null;
      if (payload?.data) {
        // 后端返回真实 liked，纠正乐观更新
        if (typeof payload.data.liked === "boolean") setLiked(payload.data.liked);
        setMetrics({ views: payload.data.views, likes: payload.data.likes });
      }
    } catch {
      setLiked(wasLiked);
      setMetrics((m) => ({ ...m, likes: Math.max(0, m.likes + (wasLiked ? 1 : -1)) }));
    }
  }

  function scrollToComments() {
    document.getElementById("comments")?.scrollIntoView({ behavior: "smooth" });
  }

  return (
    <div className="article-action-bar flex items-center gap-4 text-[16px] text-muted">
      <button
        type="button"
        onClick={toggleLike}
        aria-label={liked ? "已喜欢" : "喜欢文章"}
        aria-pressed={liked}
        className={`inline-flex items-center gap-1 rounded-full px-1 py-0.5 transition hover:text-accent active:scale-90 ${liked ? "text-accent" : ""}`}
      >
        <MetricIcon type="like" />
        <span>{metrics.likes}</span>
      </button>
      <span className="inline-flex items-center gap-1 rounded-full px-1 py-0.5" aria-label="浏览次数">
        <MetricIcon type="view" />
        {metrics.views}
      </span>
      <button
        type="button"
        onClick={scrollToComments}
        aria-label="查看评论"
        className="inline-flex items-center gap-1 rounded-full px-1 py-0.5 transition-colors hover:text-accent"
      >
        <MetricIcon type="comment" />
        <span>{commentCount}</span>
      </button>
    </div>
  );
}
