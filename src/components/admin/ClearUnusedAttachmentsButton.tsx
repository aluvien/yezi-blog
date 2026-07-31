"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { clearUnusedAttachmentsAction } from "@/lib/actions/attachments";

export default function ClearUnusedAttachmentsButton({ count }: { count: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending || count === 0}
      onClick={() => {
        if (!window.confirm(`确定清理 ${count} 个未引用附件？此操作不可恢复。`)) return;
        startTransition(async () => {
          const result = await clearUnusedAttachmentsAction();
          if (!result.ok) window.alert(result.error);
          router.refresh();
        });
      }}
      className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {pending ? "清理中…" : `一键清理未引用（${count}）`}
    </button>
  );
}
