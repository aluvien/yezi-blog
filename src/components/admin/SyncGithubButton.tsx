"use client";

import type { ReactNode } from "react";
import { useEffect, useState, useTransition } from "react";
import {
  getGithubDeployStatusAction,
  getGithubVersionStatusAction,
  syncLatestGithubAction,
  type GithubVersionStatus,
} from "@/lib/actions/sync";

type Props = {
  trailingAction?: ReactNode;
};

export default function SyncGithubButton({ trailingAction }: Props) {
  const [pending, startTransition] = useTransition();
  const [status, setStatus] = useState<{ kind: "pending" | "success" | "error"; text: string } | null>(null);
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
    // Server Action 会依次执行备份、拉取、构建和 PM2 重启，可能持续几十秒。
    // 先更新本地状态，让用户能立即确认点击已经生效，不把反馈留到请求结束后。
    setStatus({ kind: "pending", text: "正在备份数据库并同步 GitHub，构建完成后自动重启…" });
    startTransition(async () => {
      try {
        const result = await syncLatestGithubAction();
        if (!result.ok) {
          setStatus({ kind: "error", text: result.error });
          return;
        }
        setStatus({ kind: "pending", text: result.message });
        let statusReadFailures = 0;
        for (let attempt = 0; attempt < 180; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 2000));
          let deploy: Awaited<ReturnType<typeof getGithubDeployStatusAction>>;
          try {
            deploy = await getGithubDeployStatusAction();
          } catch {
            statusReadFailures += 1;
            if (statusReadFailures >= 5) {
              setStatus({ kind: "error", text: "连续无法读取部署状态，服务可能未正常启动；请刷新页面查看失败详情。" });
            } else {
              setStatus({ kind: "pending", text: "服务正在重启，暂时无法读取部署状态…" });
            }
            continue;
          }
          statusReadFailures = 0;
          if (deploy.status === "success") {
            setStatus({ kind: "success", text: "同步、构建和 PM2 重启均已成功。" });
            await checkVersion();
            return;
          }
          if (deploy.status === "failed") {
            setStatus({ kind: "error", text: `部署失败：${deploy.error || "未知错误"}` });
            return;
          }
          const stage = deploy.status === "queued" ? "等待部署任务启动"
            : deploy.status === "building" ? "正在独立 release 中安装依赖并构建"
            : deploy.status === "switching" ? "正在停止旧进程、备份数据库并切换 release"
            : deploy.status === "checking" ? "新 release 已启动，正在执行健康检查"
            : deploy.status === "rolling_back" ? "健康检查失败，正在自动回滚"
            : "正在部署";
          setStatus({ kind: "pending", text: stage });
        }
        setStatus({ kind: "pending", text: "部署仍在服务器后台运行，可稍后刷新此页查看最终状态。" });
        await checkVersion();
      } catch (error) {
        setStatus({
          kind: "error",
          text: error instanceof Error ? `同步请求未完成：${error.message}` : "同步请求未完成，请刷新后重试",
        });
      }
    });
  }

  return (
    <div className="w-full min-w-0 sm:w-[24rem]">
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={sync}
          disabled={pending}
          className="admin-button admin-button-secondary inline-flex h-10 w-[6rem] min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-neutral-300 px-2 text-sm text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900 disabled:cursor-wait disabled:opacity-50"
        >
          {pending ? "同步中…" : "同步 GitHub"}
        </button>
        <div className="h-10 min-w-0 flex-1 overflow-hidden text-left text-xs leading-5" aria-live="polite">
          {status && <p className={`line-clamp-2 ${status.kind === "success" ? "text-green-600" : status.kind === "pending" ? "text-amber-600" : "text-red-600"}`}>{status.text}</p>}
        </div>
        {trailingAction}
      </div>
      <div className="mt-2 min-h-10 w-full text-left text-xs leading-5" aria-live="polite">
        {checkingVersion && <p className="line-clamp-2 text-neutral-400">正在检查 GitHub 最新版本…</p>}
        {!checkingVersion && version?.status === "up-to-date" && (
          <p className="line-clamp-2 text-neutral-400">代码已是最新 · {version.localCommit}</p>
        )}
        {!checkingVersion && version?.status === "outdated" && (
          <p className="line-clamp-2 font-medium text-amber-600">
            GitHub 有新版本（本地 {version.localCommit} · 最新 {version.remoteCommit}），请点击同步
          </p>
        )}
        {!checkingVersion && version?.status === "dirty" && (
          <p className="line-clamp-2 font-medium text-red-600">
            服务器有未提交源码改动，暂不能安全同步
          </p>
        )}
        {!checkingVersion && version?.status === "unavailable" && (
          <p className="line-clamp-2 text-neutral-400">
            {version.error || "暂时无法检查 GitHub 最新版本"}
          </p>
        )}
      </div>
    </div>
  );
}
