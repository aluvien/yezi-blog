"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";

function scrollToRouteStart(): void {
  const hash = window.location.hash.slice(1);
  let targetId = hash;
  try {
    targetId = decodeURIComponent(hash);
  } catch {
    // 保留原始 hash，避免异常编码阻断页面渲染。
  }
  const target = targetId ? document.getElementById(targetId) : null;

  if (target) {
    target.scrollIntoView({ block: "start", behavior: "auto" });
    return;
  }

  const main = document.querySelector<HTMLElement>(".site-main");
  if (main) main.scrollTop = 0;
  window.scrollTo(0, 0);
}

/** 站内路由切换时重置持久滚动容器；明确的 URL 锚点仍然优先定位。 */
export function SiteScrollManager() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;

  useEffect(() => {
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(scrollToRouteStart);
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [routeKey]);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    return () => {
      window.history.scrollRestoration = previous;
    };
  }, []);

  return null;
}
