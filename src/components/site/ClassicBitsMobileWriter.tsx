"use client";

import dynamic from "next/dynamic";
import { useState } from "react";

const MomentForm = dynamic(() => import("@/components/admin/MomentForm"), { ssr: false });

/** 经典版絮语页的移动端发布入口；桌面端继续使用工具栏内的文字按钮。 */
export function ClassicBitsMobileWriter({ isAuthorized }: { isAuthorized: boolean }) {
  const [open, setOpen] = useState(false);

  if (!isAuthorized) return null;

  return (
    <>
      <div className="page-actions classic-bits-mobile-actions">
        <button
          type="button"
          className="classic-bits-mobile-action"
          aria-label={open ? "收起碎碎念" : "碎碎念"}
          aria-expanded={open}
          title={open ? "收起碎碎念" : "碎碎念"}
          onClick={() => setOpen((value) => !value)}
        >
          <span className="classic-bits-mobile-action__icon" aria-hidden="true">✍</span>
          <span className="classic-bits-mobile-action__label">{open ? "收起" : "碎碎念"}</span>
        </button>
      </div>
      {open ? (
        <div className="classic-bits-mobile-publisher">
          <MomentForm compact uploadEndpoint="/api/moments/upload" onSuccess={() => setOpen(false)} />
        </div>
      ) : null}
    </>
  );
}
