"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";

export function ClassicReaderToggle() {
  const [active, setActive] = useState(false);

  function toggle() {
    const next = !active;
    setActive(next);
    document.body.dataset.reading = next ? "immersive" : "normal";
    document.body.classList.toggle("immersive-page", next);
  }

  return (
    <button
      type="button"
      className="classic-reader-toggle"
      aria-label={active ? "退出阅读模式" : "阅读模式"}
      aria-pressed={active}
      title={active ? "退出阅读模式" : "阅读模式"}
      onClick={toggle}
    >
      <BookOpen className="classic-action-icon" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
