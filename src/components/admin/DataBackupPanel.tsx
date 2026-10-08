"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, Download, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import type { AdminBackupPhase, AdminBackupStatus, LocalBackupFile, LocalBackupKind, LocalBackupList } from "@/lib/admin-backup-types";

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

const KIND_LABELS: Record<LocalBackupKind, string> = {
  admin: "手动完整备份", database: "数据库快照", data: "自动加密数据备份", restore: "恢复前安全备份",
};
function localDownloadUrl(file: LocalBackupFile): string {
  return `/api/admin/v1/backups/files/download?${new URLSearchParams({ kind: file.kind, name: file.name })}`;
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes >= 1024 ** 3 ? "GB" : bytes >= 1024 ** 2 ? "MB" : "KB";
  const divisor = unit === "GB" ? 1024 ** 3 : unit === "MB" ? 1024 ** 2 : 1024;
  return `${(bytes / divisor).toFixed(2)} ${unit}`;
}

export default function DataBackupPanel() {
  const [status, setStatus] = useState<AdminBackupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [local, setLocal] = useState<LocalBackupList | null>(null);
  const [listError, setListError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [refreshing, setRefreshing] = useState(true);
  const [deleting, setDeleting] = useState("");
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
        const filesResponse = await fetch("/api/admin/v1/backups/files", { cache: "no-store", signal: controller.signal });
        const filesBody = await filesResponse.json();
        if (!filesResponse.ok) throw new Error(filesBody.error?.message || "读取本地备份列表失败");
        if (disposed) return;
        setLocal(filesBody.data);
        setListError("");
        if (filesBody.data?.busy) nextDelay = 1500;
      } catch (cause) {
        if (disposed) return;
        failures += 1;
        setListError(cause instanceof Error ? cause.message : "读取备份状态失败");
      } finally {
        if (!disposed) {
          setLoading(false);
          setRefreshing(false);
          timer = setTimeout(read, failures > 0 ? 5000 : nextDelay);
        }
      }
    };
    void read();
    return () => { disposed = true; controller.abort(); clearTimeout(timer); };
  }, [monitoring, refresh]);

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

  async function remove(file: LocalBackupFile) {
    if (requesting.current) return;
    if (!window.confirm(`确定永久删除这份服务器本地备份？\n${KIND_LABELS[file.kind]} · ${formatBytes(file.sizeBytes)}\n${file.name}\n删除后无法恢复，网站当前数据和云端备份不受影响。`)) return;
    requesting.current = true;
    setDeleting(`${file.kind}/${file.name}`);
    setError("");
    try {
      const response = await fetch("/api/admin/v1/backups/files", {
        method: "DELETE", headers: { "Content-Type": "application/json", "X-Yezi-Csrf": "1" },
        body: JSON.stringify({ kind: file.kind, name: file.name, confirmation: "删除备份" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "删除本地备份失败");
      setLocal(body.data);
      if (file.kind === "admin" && file.name === `${status?.id}.tar.gz`) setStatus(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "删除本地备份失败"); }
    finally { requesting.current = false; setDeleting(""); setRefresh(value => value + 1); }
  }

  const running = starting || status?.status === "running";
  const busy = running || Boolean(local?.busy) || Boolean(deleting);
  const latest = local?.files.find(file => file.kind === "admin");
  const step = status ? PHASES.findIndex((item) => item.phase === status.phase) + 1 : 0;

  return (
    <section aria-labelledby="data-backup-title" className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <Archive size={19} className="text-neutral-500" />
        <h2 id="data-backup-title" className="text-base font-semibold text-neutral-900">数据备份</h2>
      </div>
      <p className="mt-2 text-sm leading-6 text-neutral-600">一键下载数据库、上传图片与附件、引用归档、环境文件和 PM2 等应用配置。备份在后台执行，网站可以继续访问。</p>
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">下载包未加密，包含后台密码、接口密钥和 QQ Cookie，请妥善保存，不要上传公开仓库。备份期间请避免删除附件或修改配置。</p>
      <p className="mt-2 text-xs leading-5 text-neutral-500">服务器保留最近 3 份手动完整备份；“下载最近备份”下载最新一份。备份包不包含历史备份、临时文件和可再生成的 QQ 音频缓存，附带恢复说明与文件校验清单。</p>
      <div aria-live="polite" className="mt-4 text-sm text-neutral-600">
        {loading ? <p>正在读取备份状态…</p> : status?.status === "running" ? (
          <div className="space-y-2">
            <p className="flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />{PHASES.find((item) => item.phase === status.phase)?.label || "正在备份"} · {step}/5</p>
            <progress aria-label="备份进度" value={step} max={5} className="h-1.5 w-full accent-neutral-900" />
            <p className="text-xs text-neutral-500">可以继续浏览；刷新或重新进入页面后会继续显示进度。</p>
          </div>
        ) : status?.status === "completed" ? (
          <p>最近备份：{new Date(status.updatedAt).toLocaleString("zh-CN")} · {((status.sizeBytes ?? 0) / 1024 / 1024).toFixed(2)} MB · {status.fileCount} 个文件，校验通过</p>
        ) : status?.status === "failed" ? <p className="text-red-600">{status.error}</p> : <p>{latest ? "已保存的手动完整备份可从下方下载。" : "尚未创建手动完整备份。"}</p>}
        {error && <p role="alert" className="mt-2 text-red-600">{error}</p>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" disabled={loading || busy} onClick={() => void start()} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {running ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
          {running ? "正在备份…" : "备份并下载"}
        </button>
        {latest && <a href={localDownloadUrl(latest)} download className="text-sm text-neutral-700 underline underline-offset-4">下载最近备份</a>}
        {status?.status === "completed" && <a ref={link} href={downloadUrl(status.id)} download hidden aria-hidden="true" tabIndex={-1}>下载新备份</a>}
      </div>
      <div className="mt-6 border-t border-neutral-200 pt-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-neutral-900">服务器本地备份</h3>
            <p aria-live="polite" className="mt-1 text-xs text-neutral-500">{local ? `共 ${local.count} 份 · 占用 ${formatBytes(local.totalBytes)}` : "正在读取本地备份…"}</p>
          </div>
          <button type="button" disabled={refreshing || Boolean(deleting)} onClick={() => { setRefreshing(true); setRefresh(value => value + 1); }} className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">
            <RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />刷新本地备份
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-neutral-500">显示已完成的手动完整备份、数据库快照、自动加密数据备份和恢复前安全备份。数据库快照仅包含数据库；自动加密数据备份需要原加密密钥才能恢复。各类备份按原保留设置自动清理。</p>
        {listError && <p role="alert" className="mt-2 text-sm text-red-600">{listError}</p>}
        {busy && <p role="status" className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">备份、恢复或删除任务正在执行，暂时不能删除本地备份。</p>}
        {local?.files.length === 0 && <p className="mt-4 text-sm text-neutral-500">服务器暂无已完成的本地备份。</p>}
        {Boolean(local?.files.length) && <ul className="mt-4 space-y-3">
          {local!.files.map(file => {
            const removing = deleting === `${file.kind}/${file.name}`;
            return <li key={`${file.kind}/${file.name}`} className="rounded-xl border border-neutral-200 p-3 sm:p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-neutral-800">{KIND_LABELS[file.kind]}</p>
                  <p className="mt-1 break-all text-xs text-neutral-500">{file.name}</p>
                  <p className="mt-2 text-xs text-neutral-600"><time dateTime={file.createdAt}>{new Date(file.createdAt).toLocaleString("zh-CN")}</time> · {formatBytes(file.sizeBytes)}{file.encrypted ? " · 已加密" : ""}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <a href={localDownloadUrl(file)} download aria-label={`下载本地备份 ${file.name}`} className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-50"><Download size={14} />下载</a>
                  <button type="button" disabled={busy || refreshing || Boolean(listError)} onClick={() => void remove(file)} aria-label={`删除本地备份 ${file.name}`} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50">
                    {removing ? <LoaderCircle size={14} className="animate-spin" /> : <Trash2 size={14} />}{removing ? "正在删除…" : "删除"}
                  </button>
                </div>
              </div>
            </li>;
          })}
        </ul>}
      </div>
    </section>
  );
}
