"use client";

import { useEffect, useRef } from "react";
import { attachScrollListener, readScrollPosition } from "./scroll-utils";

/**
 * 文章页阅读进度条：作为 header 子元素绝对定位贴住导航下沿，消除与导航的间隙。
 * 滚动用 rAF 节流，并直接写 transform（不触发 React 重渲染、GPU 合成、无 transition 冲突），避免卡顿。
 */
export function ReadingProgress() {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      const { scrollTop, scrollHeight, clientHeight } = readScrollPosition();
      const max = scrollHeight - clientHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, scrollTop / max)) : 0;
      if (barRef.current) barRef.current.style.transform = `scaleX(${ratio})`;
    };
    const onScroll = () => {
      if (raf === 0) raf = requestAnimationFrame(update);
    };
    const cleanup = attachScrollListener(onScroll);
    update();
    return () => {
      cleanup();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="pointer-events-none absolute inset-x-0 -bottom-px h-[2px] overflow-hidden">
      <div ref={barRef} className="h-full w-full origin-left bg-accent" style={{ transform: "scaleX(0)" }} />
    </div>
  );
}
