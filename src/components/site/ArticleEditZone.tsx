"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/** 管理员前台编辑入口：悬停或触摸内容区域时显示。 */
export function ArticleEditZone({
  href,
  enabled,
  children,
  zoneClassName = "article-edit-zone",
  buttonClassName = "article-edit-btn",
  label = "编辑文章",
}: {
  href: string;
  enabled: boolean;
  children: React.ReactNode;
  zoneClassName?: string;
  buttonClassName?: string;
  label?: string;
}) {
  const [touchActive, setTouchActive] = useState(false);
  const zoneRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!touchActive) return;
    const handleOutsideTouch = (event: TouchEvent) => {
      if (!zoneRef.current?.contains(event.target as Node)) setTouchActive(false);
    };
    document.addEventListener("touchstart", handleOutsideTouch, { passive: true });
    return () => document.removeEventListener("touchstart", handleOutsideTouch);
  }, [touchActive]);

  if (!enabled) return <>{children}</>;

  return (
    <div
      ref={zoneRef}
      className={`${zoneClassName} ${touchActive ? "is-touch-active" : ""}`}
      onTouchStart={() => setTouchActive(true)}
    >
      {children}
      <Link href={href} className={buttonClassName} title={label} aria-label={label}>
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
        {label}
      </Link>
    </div>
  );
}
