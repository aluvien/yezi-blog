"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

type Props = {
  summary: string;
  points: string[];
};

function getScrollHost(): HTMLElement | null {
  const candidates = [
    document.querySelector<HTMLElement>(".admin-shell"),
    document.querySelector<HTMLElement>(".site-main"),
  ];
  return candidates.find((element) => element && element.scrollHeight > element.clientHeight) ?? null;
}

export default function AdminReferenceSummary({ summary, points }: Props) {
  const summaryRef = useRef<HTMLButtonElement>(null);
  const beforeTopRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const summaryId = useId();

  function capturePosition() {
    beforeTopRef.current = summaryRef.current?.getBoundingClientRect().top ?? null;
  }

  function preservePosition() {
    const beforeTop = beforeTopRef.current;
    beforeTopRef.current = null;
    if (beforeTop === null) return;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const currentTop = summaryRef.current?.getBoundingClientRect().top;
        if (currentTop === undefined || currentTop === null) return;
        const delta = currentTop - beforeTop;
        if (Math.abs(delta) < 0.5) return;

        const scrollHost = getScrollHost();
        if (scrollHost) {
          scrollHost.scrollTop += delta;
        } else {
          window.scrollBy(0, delta);
        }
      });
    });

    window.setTimeout(() => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    }, 100);
  }

  function captureKeyboardPosition(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") capturePosition();
  }

  useEffect(() => {
    preservePosition();
  }, [open]);

  return (
    <>
      <button
        type="button"
        ref={summaryRef}
        onPointerDown={capturePosition}
        onKeyDown={captureKeyboardPosition}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={summaryId}
        className="admin-reference-summary-trigger cursor-pointer text-accent"
      >
        查看摘要
      </button>
      {open && (
        <div id={summaryId} className="admin-reference-summary-body rounded-lg bg-neutral-50 p-3 leading-5 text-neutral-600">
          {summary && <p>{summary}</p>}
          {points.length > 0 && <p className="mt-1">要点：{points.join(" · ")}</p>}
        </div>
      )}
    </>
  );
}
