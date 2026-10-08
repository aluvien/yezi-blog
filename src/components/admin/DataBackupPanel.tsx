"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Download, LoaderCircle } from "lucide-react";
import type { AdminBackupPhase, AdminBackupStatus } from "@/lib/admin-backup-types";

const PHASES: Array<{ phase: AdminBackupPhase; label: string }> = [
  { phase: "database", label: "生成数据库快照" },
  { phase: "files", label: "复制上传文件与持久化数据" },
  { phase: "config", label: "收集环境与应用配置" },
  { phase: "archive", label: "压缩备份文件" },
  { phase: "verify", label: "校验数据库与文件" },
];

function downloadUrl(id: string): string {
  return `/api/admin/v1/backups/download?id=${encodeURIComponent(id)}`;
}

export default function DataBackupPanel() {
  const [status, setStatus] = useState<AdminBackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const autoDownload = useRef<string | null>(null);
  const link = useRef<HTMLAnchorElement>(null);
  const requesting = useRef(false);
  const monitoring = status?.status === "running";

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let nextDelay = 30_000;
    const controller = new AbortController();
    const read = async () => {
      try {
        const response = await fetch("/api/admin/v1/backups", { cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "读取备份状态失败");
        if (disposed) return;
        failures = 0;
        nextDelay = body.data?.status === "running" ? 1500 : 30_000;
        setStatus(body.data);
        setError("");
      } catch (cause) {
        if (disposed) return;
        failures += 1;
        setError(cause instanceof Error ? cause.message : "读取备份状态失败");
      } finally {
        if (!disposed) {
          setLoading(false);
          timer = setTimeout(read, failures > 0 ? 5000 : nextDelay);
        }
      }
    };
    void read();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [monitoring]);

  useEffect(() => {
    if (status?.status === "completed" && autoDownload.current === status.id) {
      autoDownload.current = null;
      link.current?.click();
    }
  }, [status]);

  async function start() {
    if (requesting.current) return;
    requesting.current = true;
    setStarting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/v1/backups", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Yezi-Csrf": "1" }, body: "{}",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "创建备份失败");
      autoDownload.current = body.data.id;
      setStatus(body.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "创建备份失败"); }
    finally { requesting.current = false; setStarting(false); }
  }

  const running = starting || status?.status === "running";
  const step = status ? PHASES.findIndex((item) => item.phase === status.phase) + 1 : 0;

  return (
    <section aria-labelledby="data-backup-title" className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Archive size={19} className="text-neutral-500" />
        <h2 id="data-backup-title" className="text-base font-semibold text-neutral-900">数据备份</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-neutral-600">一键下载数据库、上传图片与附件、引用归档、环境文件和 PM2 等应用配置。备份在后台执行，网站可以继续访问。</p>
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">下载包未加密，包含后台密码、接口密钥和 QQ Cookie，请妥善保存，不要上传公开仓库。备份期间请避免删除附件或修改配置。</p>
      <p className="mt-2 text-xs leading-5 text-neutral-500">服务器保留最近 3 份完整备份；“下载最近备份”下载最新一份。备份包不包含历史备份、临时文件和可再生成的 QQ 音频缓存，附带恢复说明与文件校验清单。</p>
      <div aria-live="polite" className="mt-4 text-sm text-neutral-600">
        {loading ? <p>正在读取备份状态…</p> : status?.status === "running" ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />{PHASES.find((item) => item.phase === status.phase)?.label || "正在备份"} · {step}/5</p>
            <progress aria-label="备份进度" value={step} max={5} className="h-1.5 w-full accent-neutral-900" />
            <p className="text-xs text-neutral-500">可以继续浏览；刷新或重新进入页面后会继续显示进度。</p>
          </div>
        ) : status?.status === "completed" ? (
          <p>最近备份：{new Date(status.updatedAt).toLocaleString("zh-CN")} · {((status.sizeBytes ?? 0) / 1024 / 1024).toFixed(2)} MB · {status.fileCount} 个文件，校验通过</p>
        ) : status?.status === "failed" ? <p className="text-red-600">{status.error}</p> : <p>尚未创建手动完整备份。</p>}
        {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={loading || running} onClick={() => void start()} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {running ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
          {running ? "正在备份…" : "备份并下载"}
        </button>
        {status?.status === "completed" && <a ref={link} href={downloadUrl(status.id)} download className="text-sm text-neutral-700 underline underline-offset-4">下载最近备份</a>}
      </div>
    </section>
  );
}
