"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/lib/actions/posts";

export default function DeleteButton({
  action,
  confirmText = "确定删除？此操作不可恢复。",
}: {
  action: () => Promise<ActionResult>;
  confirmText?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirmText)) return;
        startTransition(async () => {
          const r = await action();
          if (!r.ok) window.alert(r.error);
          router.refresh();
        });
      }}
      className="text-sm text-red-600 disabled:opacity-50"
    >
      {pending ? "删除中…" : "删除"}
    </button>
  );
}
