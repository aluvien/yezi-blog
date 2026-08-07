"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";

const LONG_PRESS_MS = 450;
const LONG_PRESS_MOVE_TOLERANCE = 10;

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
  const editButtonRef = useRef<HTMLAnchorElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressResetTimerRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimerRef.current === null) return;
    window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = null;
  }

  function clearLongPressResetTimer() {
    if (longPressResetTimerRef.current === null) return;
    window.clearTimeout(longPressResetTimerRef.current);
    longPressResetTimerRef.current = null;
  }

  function scheduleLongPressReset() {
    clearLongPressResetTimer();
    longPressResetTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = false;
      longPressResetTimerRef.current = null;
    }, 800);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || editButtonRef.current?.contains(event.target as Node)) return;
    clearLongPressTimer();
    clearLongPressResetTimer();
    longPressTriggeredRef.current = false;
    touchStartRef.current = { x: event.clientX, y: event.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      longPressTimerRef.current = null;
      setTouchActive(true);
    }, LONG_PRESS_MS);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch" || !touchStartRef.current) return;
    const movedX = Math.abs(event.clientX - touchStartRef.current.x);
    const movedY = Math.abs(event.clientY - touchStartRef.current.y);
    if (movedX > LONG_PRESS_MOVE_TOLERANCE || movedY > LONG_PRESS_MOVE_TOLERANCE) {
      clearLongPressTimer();
      touchStartRef.current = null;
    }
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") return;
    clearLongPressTimer();
    touchStartRef.current = null;
    if (longPressTriggeredRef.current) scheduleLongPressReset();
  }

  function handleClickCapture(event: ReactMouseEvent<HTMLDivElement>) {
    if (!longPressTriggeredRef.current) return;
    const clickedEditButton = editButtonRef.current?.contains(event.target as Node);
    longPressTriggeredRef.current = false;
    clearLongPressResetTimer();
    if (clickedEditButton) return;
    event.preventDefault();
    event.stopPropagation();
  }

  useEffect(() => {
    if (!touchActive) return;
    const handleOutsideTouch = (event: TouchEvent) => {
      if (!zoneRef.current?.contains(event.target as Node)) {
        setTouchActive(false);
        longPressTriggeredRef.current = false;
      }
    };
    document.addEventListener("touchstart", handleOutsideTouch, { passive: true });
    return () => document.removeEventListener("touchstart", handleOutsideTouch);
  }, [touchActive]);

  useEffect(() => () => {
    clearLongPressTimer();
    clearLongPressResetTimer();
  }, []);

  if (!enabled) return <>{children}</>;

  return (
    <div
      ref={zoneRef}
      className={`${zoneClassName} ${touchActive ? "is-touch-active" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClickCapture={handleClickCapture}
    >
      {children}
      <Link ref={editButtonRef} href={href} className={buttonClassName} title={label} aria-label={label}>
        <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
        </svg>
        {label}
      </Link>
    </div>
  );
}
