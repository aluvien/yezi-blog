"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

export default function BackupFileMenu({ name, children }: { name: string; children: ReactNode }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function outside(event: PointerEvent) { if (menu.current?.open && !menu.current.contains(event.target as Node)) menu.current.open = false; }
    function escape(event: KeyboardEvent) { if (event.key === "Escape" && menu.current?.open) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  return <details ref={menu} className="admin-file-menu"><summary aria-label={`更多操作 ${name}`} title="详情与更多操作"><MoreHorizontal size={19} /></summary><div className="admin-file-popover"><p className="admin-file-caption">备份文件</p><p className="admin-file-name">{name}</p>{children}</div></details>;
}
