"use client";

import { useState, useTransition } from "react";
import { getGithubDeployStatusAction, syncLatestGithubAction } from "@/lib/actions/sync";

export default function SyncGithubButton() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function sync() {
    setStatus(null);
    startTransition(async () => {
      const result = await syncLatestGithubAction();
      if (!result.ok) {
        setStatus({ kind: "error", text: result.error });
        return;
      }
      setStatus({ kind: "success", text: `${result.message} 正在确认重启状态…` });
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        let deploy: Awaited<ReturnType<typeof getGithubDeployStatusAction>>;
        try {
          deploy = await getGithubDeployStatusAction();
        } catch {
          continue;
        }
        if (deploy.status === "success") {
          setStatus({ kind: "success", text: "同步、构建和 PM2 重启均已成功。" });
          return;
        }
        if (deploy.status === "failed") {
          setStatus({ kind: "error", text: `代码已构建，但 PM2 重启失败：${deploy.error || "未知错误"}` });
          return;
        }
      }
      setStatus({ kind: "success", text: "代码已同步并完成构建，PM2 正在重启，请稍后刷新页面确认。" });
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
