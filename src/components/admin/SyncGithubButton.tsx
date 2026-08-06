"use client";

import { useState, useTransition } from "react";
import { syncLatestGithubAction } from "@/lib/actions/sync";

export default function SyncGithubButton() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function sync() {
    setStatus(null);
    startTransition(async () => {
      const result = await syncLatestGithubAction();
      setStatus(result.ok ? { kind: "success", text: result.message } : { kind: "error", text: result.error });
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={sync}
        disabled={pending}
        className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900 disabled:cursor-wait disabled:opacity-50"
      >
        {pending ? "同步中…" : "同步 GitHub"}
      </button>
      {status && <span className={`max-w-[260px] text-xs ${status.kind === "success" ? "text-green-600" : "text-red-600"}`}>{status.text}</span>}
    </div>
  );
}
