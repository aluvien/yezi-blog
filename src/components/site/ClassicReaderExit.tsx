"use client";

import { useEffect, useState } from "react";
import { SquareArrowRightExit } from "lucide-react";

export function ClassicReaderExit() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const body = document.body;
    const sync = () => setVisible(body.dataset.reading === "immersive");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(body, { attributes: true, attributeFilter: ["data-reading"] });
    return () => observer.disconnect();
  }, []);

  return (
    <button id="reader-exit" className="icon-button reader-exit" type="button" aria-label="退出阅读模式" data-visible={visible} onClick={() => document.getElementById("reader-toggle")?.click()}>
      <SquareArrowRightExit className="icon" strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
