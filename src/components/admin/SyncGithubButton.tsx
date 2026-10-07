"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import type { GithubDeployStatus, GithubVersionStatus } from "@/lib/actions/sync";

type Props = { trailingAction?: ReactNode };
type AdminApiResponse<T> = { data?: T; error?: { message?: string } };
type StartResult = { changed?: boolean; taskId?: string; message: string };

async function fetchAdminStatus<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${path}?_=${Date.now()}`, {
    ...init, cache: "no-store", credentials: "same-origin",
    headers: { Accept: "application/json", ...init?.headers },
  });
  const payload = await response.json().catch(() => null) as AdminApiResponse<T> | null;
  if (!response.ok || !payload?.data) throw new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`);
  return payload.data;
}

async function readVersionStatus(): Promise<GithubVersionStatus> {
  try { return await fetchAdminStatus<GithubVersionStatus>("/api/admin/v1/deploy/version"); }
  catch { return { status: "unavailable", error: "暂时无法检查 GitHub 最新版本，请稍后重试" }; }
}

function isActive(deploy: GithubDeployStatus | null): boolean {
  return Boolean(deploy && ["queued", "building", "switching", "checking", "rolling_back"].includes(deploy.status));
}

export default function SyncGithubButton({ trailingAction }: Props) {
  const [starting, setStarting] = useState(false);
  const [deploy, setDeploy] = useState<GithubDeployStatus | null>(null);
  const [status, setStatus] = useState<{ kind: "pending" | "success" | "error"; text: string } | null>(null);
  const [version, setVersion] = useState<GithubVersionStatus | null>(null);
  const [checkingVersion, setCheckingVersion] = useState(true);
  const deploying = isActive(deploy);
  const pending = starting || deploying;
  const canUpdate = !pending && !checkingVersion && version?.status === "outdated";

  async function checkVersion() {
    setCheckingVersion(true);
    setVersion(await readVersionStatus());
    setCheckingVersion(false);
  }

  useEffect(() => {
    let active = true;
    void Promise.all([
      readVersionStatus(),
      fetchAdminStatus<GithubDeployStatus>("/api/admin/v1/deploy/status").catch(() => null),
    ]).then(([result, task]) => {
      if (!active) return;
      setVersion(result);
      setCheckingVersion(false);
      if (isActive(task)) setDeploy(task);
    });
    return () => { active = false; };
  }, []);

  // Keep reading the durable task after refresh and across the brief PM2 restart.
  // Stable JSON endpoints continue to work when this page has an old JS bundle.
  useEffect(() => {
    if (!deploying) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const current = await fetchAdminStatus<GithubDeployStatus>("/api/admin/v1/deploy/status");
        if (!active) return;
        if (!deploy?.taskId || current.taskId === deploy.taskId) {
          if (current.status === "success" || current.status === "failed") {
            const result = await readVersionStatus();
            if (!active) return;
            setVersion(result);
            setDeploy(current);
            setStatus({ kind: current.status === "success" ? "success" : "error", text: current.status === "success" ? (current.message || "更新完成，网站正常运行。") : `部署失败：${current.error || "未知错误"}` });
            return;
          }
          setDeploy(current);
          setStatus({ kind: "pending", text: current.message || "更新任务正在运行…" });
        }
      } catch {
        if (active) setStatus({ kind: "pending", text: "正在切换版本或暂时无法连接，恢复后会继续显示进度…" });
      }
      if (active) timer = setTimeout(poll, 2_000);
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [deploying, deploy?.taskId]);

  async function sync() {
    if (!canUpdate) return;
    setStarting(true);
    setStatus({ kind: "pending", text: "正在再次检查版本并启动更新…" });
    try {
      const result = await fetchAdminStatus<StartResult>("/api/admin/v1/deploy/sync", {
        method: "POST", headers: { "Content-Type": "application/json", "x-yezi-csrf": "1" }, body: "{}",
      });
      if (result.changed === false) {
        setStatus({ kind: "success", text: result.message });
        await checkVersion();
      } else {
        setDeploy({ status: "queued", taskId: result.taskId, message: result.message });
        setStatus({ kind: "pending", text: result.message });
      }
    } catch (error) {
      setStatus({ kind: "error", text: error instanceof Error ? error.message : "无法启动更新" });
      await checkVersion();
    } finally { setStarting(false); }
  }

  return (
    <div className="w-full min-w-0 sm:w-[24rem]">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => void sync()} disabled={!canUpdate}
          className="admin-button admin-button-secondary inline-flex h-10 w-[6rem] min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-neutral-300 px-2 text-sm text-neutral-700 transition-colors hover:border-neutral-900 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-50">
          {pending ? "更新中…" : "同步 GitHub"}
        </button>
        <div className="min-h-10 min-w-0 flex-1 text-left text-xs leading-5" aria-live="polite">
          {status && <p className={status.kind === "success" ? "text-green-600" : status.kind === "pending" ? "text-amber-600" : "text-red-600"}>{status.text}</p>}
          {deploying && deploy?.step && deploy.totalSteps && <p className="text-neutral-500">更新步骤 {deploy.step}/{deploy.totalSteps}</p>}
        </div>
        {trailingAction}
      </div>
      <div className="mt-2 min-h-10 w-full text-left text-xs leading-5" aria-live="polite">
        {checkingVersion && <p className="text-neutral-400">正在检查 GitHub 最新版本…</p>}
        {!checkingVersion && version?.status === "up-to-date" && <p className="text-neutral-400">代码已是最新 · {version.localCommit}</p>}
        {!checkingVersion && version?.status === "outdated" && <p className="font-medium text-amber-600">GitHub 有新版本（本地 {version.localCommit} · 最新 {version.remoteCommit}）</p>}
        {!checkingVersion && version?.status === "dirty" && <p className="font-medium text-red-600">服务器有未提交源码改动，暂不能安全同步</p>}
        {!checkingVersion && version?.status === "unavailable" && <p className="text-neutral-400">{version.error || "暂时无法检查 GitHub 最新版本"}</p>}
      </div>
    </div>
  );
}
