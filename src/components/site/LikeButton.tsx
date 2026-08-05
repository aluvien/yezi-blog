"use client";

import { useState } from "react";
import { MetricIcon } from "@/components/site/MetricIcon";

/** 通用点赞按钮（文章/想法）：toggle 切换，初始 liked 由 SSR 查后端给出。 */
export function LikeButton({ targetType, targetId, initialLikes, initialLiked = false }: { targetType: "post" | "moment"; targetId: number; initialLikes: number; initialLiked?: boolean }) {
  const [likes, setLikes] = useState(initialLikes);
  const [liked, setLiked] = useState(initialLiked);

  async function toggleLike() {
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikes((value) => Math.max(0, value + (wasLiked ? -1 : 1)));
    try {
      const response = await fetch("/api/v1/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: targetType, target_id: targetId, kind: "like" }),
      });
      if (!response.ok) throw new Error("like failed");
      const payload = (await response.json().catch(() => null)) as { data?: { likes: number; liked?: boolean } } | null;
      if (payload?.data) {
        if (typeof payload.data.liked === "boolean") setLiked(payload.data.liked);
        setLikes(payload.data.likes);
      }
    } catch {
      setLiked(wasLiked);
      setLikes((value) => Math.max(0, value + (wasLiked ? 1 : -1)));
    }
  }

  return (
    <button
      type="button"
      onClick={toggleLike}
      aria-label={liked ? "已喜欢" : "喜欢"}
      aria-pressed={liked}
      className={`-m-1 inline-flex min-h-7 items-center gap-1 rounded-full px-1 transition-colors hover:text-accent active:scale-90 ${liked ? "text-accent" : ""}`}
    >
      <MetricIcon type="like" />
      <span>{likes}</span>
    </button>
  );
}
