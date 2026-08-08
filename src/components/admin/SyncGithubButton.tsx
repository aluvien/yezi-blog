"use client";

import { useEffect, useState, useTransition } from "react";
import {
  getGithubDeployStatusAction,
  getGithubVersionStatusAction,
  syncLatestGithubAction,
  type GithubVersionStatus,
} from "@/lib/actions/sync";

export default function SyncGithubButton() {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [version, setVersion] = useState<GithubVersionStatus | null>(null);
  const [checkingVersion, setCheckingVersion] = useState(true);

  async function checkVersion() {
    setCheckingVersion(true);
    try {
      setVersion(await getGithubVersionStatusAction());
    } catch {
      setVersion({ status: "unavailable", error: "暂时无法检查 GitHub 最新版本，请稍后重试" });
    } finally {
      setCheckingVersion(false);
    }
  }

  useEffect(() => {
    let active = true;
    void getGithubVersionStatusAction()
      .then((result) => {
        if (active) setVersion(result);
      })
      .catch(() => {
        if (active) setVersion({ status: "unavailable", error: "暂时无法检查 GitHub 最新版本，请稍后重试" });
      })
      .finally(() => {
        if (active) setCheckingVersion(false);
      });

    return () => {
      active = false;
    };
  }, []);

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
          await checkVersion();
          return;
        }
        if (deploy.status === "failed") {
          setStatus({ kind: "error", text: `代码已构建，但 PM2 重启失败：${deploy.error || "未知错误"}` });
          return;
        }
      }
      setStatus({ kind: "success", text: "代码已同步并完成构建，PM2 正在重启，请稍后刷新页面确认。" });
      await checkVersion();
    });
  }

  return (
    <div className="flex flex-col items-start gap-1 sm:items-end">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900 disabled:cursor-wait disabled:opacity-50"
        >
          {pending ? "同步中…" : "同步 GitHub"}
        </button>
        {status && <span className={`max-w-[280px] text-xs ${status.kind === "success" ? "text-green-600" : "text-red-600"}`}>{status.text}</span>}
      </div>
      {checkingVersion && <span className="text-xs text-neutral-400" aria-live="polite">正在检查 GitHub 最新版本…</span>}
      {!checkingVersion && version?.status === "up-to-date" && (
        <span className="text-xs text-neutral-400" aria-live="polite">代码已是最新 · {version.localCommit}</span>
      )}
      {!checkingVersion && version?.status === "outdated" && (
        <span className="text-xs font-medium text-amber-600" aria-live="polite">
          GitHub 有新版本（本地 {version.localCommit} · 最新 {version.remoteCommit}），请点击同步
        </span>
      )}
      {!checkingVersion && version?.status === "dirty" && (
        <span className="text-xs font-medium text-red-600" aria-live="polite">
          服务器有未提交源码改动，暂不能安全同步
        </span>
      )}
      {!checkingVersion && version?.status === "unavailable" && (
        <span className="text-xs text-neutral-400" aria-live="polite">
          {version.error || "暂时无法检查 GitHub 最新版本"}
        </span>
      )}
    </div>
  );
}
