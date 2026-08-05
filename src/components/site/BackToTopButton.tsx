"use client";

import { useEffect, useState } from "react";
import { attachScrollListener, readScrollPosition, scrollToTop } from "./scroll-utils";

export function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => setVisible(readScrollPosition().scrollTop > 280);
    const cleanup = attachScrollListener(update);
    update();
    return cleanup;
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      className="article-back-to-top"
      onClick={() => scrollToTop("smooth")}
      aria-label="返回顶部"
      title="返回顶部"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m6 14 6-6 6 6" />
      </svg>
    </button>
  );
}
