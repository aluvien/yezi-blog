"use client";

import { useEffect, useRef, useState } from "react";

/**
 * 想法进入视口后上报一次浏览。
 * 后端按 visitor key 去重，因此同一访客在 30 天内重复看到同一条不会重复累加。
 */
export function useMomentView(targetId: number, initialViews: number) {
  const [views, setViews] = useState(initialViews);
  const targetRef = useRef<HTMLElement>(null);
  const reportedRef = useRef(false);

  useEffect(() => {
    const target = targetRef.current;
    if (!target || reportedRef.current) return;

    let observer: IntersectionObserver | null = null;
    const report = () => {
      if (reportedRef.current) return;
      reportedRef.current = true;
      void fetch("/api/v1/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_type: "moment", target_id: targetId, kind: "view" }),
      })
        .then(async (response) => {
          if (!response.ok) return;
          const payload = (await response.json().catch(() => null)) as { data?: { views: number } } | null;
          if (typeof payload?.data?.views === "number") setViews(payload.data.views);
        })
        .catch(() => undefined);
    };

    if (typeof IntersectionObserver === "undefined") {
      report();
    } else {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            report();
            observer?.disconnect();
          }
        },
        { threshold: 0.35 },
      );
      observer.observe(target);
    }

    return () => observer?.disconnect();
  }, [targetId]);

  return { views, targetRef };
}
