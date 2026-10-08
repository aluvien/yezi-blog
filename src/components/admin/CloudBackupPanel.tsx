"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CloudUpload, Download, LoaderCircle, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import type { CloudBackupFile, CloudBackupSettings, CloudBackupTask, CloudBackupPhase } from "@/lib/cloud-backup-types";

const API = "/api/admin/v1/backups/cloud";
const PHASES: Record<CloudBackupPhase, string> = {
  snapshot: "生成完整备份", encrypt: "加密备份包", upload: "上传到 WebDAV", verify: "回读校验", download: "读取待恢复备份",
  decrypt: "解密备份包", validate: "校验数据库与文件", ready: "校验通过，请确认恢复", safety: "保存恢复前完整备份", restore: "恢复数据库与文件", complete: "已完成",
};
const EMPTY: CloudBackupSettings = { siteLabel: "", endpoint: "", username: "", directory: "backup", dailyEnabled: false, keep: 14, hasPassword: false, hasKey: false };
async function jsonRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store", headers: { "Content-Type": "application/json", "x-yezi-csrf": "1", ...init.headers } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "操作失败，请稍后重试。");
  return result.data as T;
}
const inputClass = "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-600 disabled:bg-neutral-50";
const buttonClass = "rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
function formatRemaining(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "计算中…";
  const value = Math.max(1, Math.ceil(seconds));
  if (value < 60) return `约 ${value} 秒`;
  if (value < 3600) return `约 ${Math.ceil(value / 60)} 分钟`;
  return `约 ${(value / 3600).toFixed(1)} 小时`;
}
export default function CloudBackupPanel() {
  const [settings, setSettings] = useState<CloudBackupSettings>(EMPTY);
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [listing, setListing] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restored, setRestored] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [task, setTask] = useState<CloudBackupTask | null>(null);
  const [otherSites, setOtherSites] = useState(false);
  const [files, setFiles] = useState<CloudBackupFile[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mounted = useRef(true);
  const initialized = useRef(false);
  const completedRestore = useRef(false);
  const lastCompleted = useRef("");
  const applying = useRef(false);
  const busy = saving || restoring || Boolean(deleting) || task?.status === "running";
  const configured = settings.hasPassword && settings.hasKey;
  const list = useCallback(async () => {
    setListing(true);
    try { setFiles(await jsonRequest<CloudBackupFile[]>(`${API}/files`)); }
    catch (issue) { setError(issue instanceof Error ? issue.message : "读取云备份列表失败。"); }
    finally { setListing(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (completedRestore.current) return;
      try {
        const data = await jsonRequest<{ settings: CloudBackupSettings; task: CloudBackupTask | null }>(API);
        if (!mounted.current) return;
        if (!initialized.current) { initialized.current = true; setSettings(data.settings); if (data.settings.hasPassword) void list(); }
        setTask(data.task);
        if (data.task?.status === "completed" && data.task.kind === "backup" && lastCompleted.current !== data.task.id) {
          lastCompleted.current = data.task.id; void list();
        }
      } catch (issue) {
        if (mounted.current && !applying.current && !completedRestore.current) setError(issue instanceof Error ? issue.message : "读取云备份状态失败。");
      } finally {
        if (mounted.current && !completedRestore.current) { setLoading(false); timer = setTimeout(() => void poll(), 2500); }
      }
    };
    void poll();
    return () => { mounted.current = false; clearTimeout(timer); };
    // Polling must not overwrite edits with saved configuration.
  }, [list]);
  function edit<K extends keyof CloudBackupSettings>(key: K, value: CloudBackupSettings[K]) {
    setSettings(current => ({ ...current, [key]: value })); setDirty(true); setMessage("");
  }
  async function save() {
    setSaving(true); setError(""); setMessage("");
    try {
      const saved = await jsonRequest<CloudBackupSettings>(API, { method: "PATCH", body: JSON.stringify({ endpoint: settings.endpoint, username: settings.username, directory: settings.directory, dailyEnabled: settings.dailyEnabled, keep: settings.keep, ...(password ? { password } : {}), ...(recoveryKey ? { recoveryKey: recoveryKey.trim() } : {}) }) });
      setSettings(saved); setPassword(""); setRecoveryKey(""); setDirty(false); setFiles([]); setConfirmation("");
      setMessage("云备份配置已保存。请测试连接，并导出恢复密钥单独保存。");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "保存失败。"); }
    finally { setSaving(false); }
  }
  async function start(action: "test" | "backup" | "prepare", name?: string) {
    setError(""); setMessage(""); setConfirmation("");
    try {
      const started = await jsonRequest<CloudBackupTask>(API, { method: "POST", body: JSON.stringify({ action, ...(name ? { name } : {}) }) });
      setTask(started); setRestored(false);
    } catch (issue) { setError(issue instanceof Error ? issue.message : "操作启动失败。"); }
  }
  async function remove(file: CloudBackupFile) {
    if (!window.confirm(`确定永久删除这份云端备份？\n网站：${file.site || "旧备份（未记录网站）"}\n${file.name}\n删除后无法恢复，本地网站数据不受影响。`)) return;
    setDeleting(file.name); setError(""); setMessage("");
    try {
      const result = await jsonRequest<{ name: string; task: CloudBackupTask | null }>(`${API}/files`, { method: "DELETE", body: JSON.stringify({ name: file.name, confirmation: "删除备份" }) });
      setFiles(current => current.filter(item => item.name !== result.name)); setTask(result.task);
      setConfirmation(""); setMessage("云端备份已删除，本地网站数据不受影响。");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "删除云备份失败。"); }
    finally { setDeleting(null); }
  }
  async function restore() {
    if (!task || confirmation !== "恢复数据") return;
    setRestoring(true); applying.current = true; setError(""); setMessage("");
    try {
      const finished = await jsonRequest<CloudBackupTask>(`${API}/restore`, { method: "POST", body: JSON.stringify({ id: task.id, confirmation }) });
      completedRestore.current = true; setTask(finished); setRestored(true); setConfirmation("");
      setMessage("数据恢复完成。恢复前的完整备份已保留，后台会话已撤销，请重新登录。");
    } catch (issue) { setError(issue instanceof Error ? issue.message : "恢复未完成，请重新登录后查看状态。"); }
    finally { setRestoring(false); applying.current = false; }
  }
  const visibleFiles = files.filter(file => otherSites ? file.site !== settings.siteLabel : file.site === settings.siteLabel);
  const transfer = task?.transfer;
  const uploading = task?.status === "running" && task.phase === "upload" && transfer;
  const ready = task?.kind === "prepare" && task.status === "completed" && task.phase === "ready" && task.preview && !restored;
  return (
    <section aria-labelledby="cloud-backup-title" className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6">
      <h2 id="cloud-backup-title" className="flex items-center gap-2 text-base font-semibold text-neutral-900"><CloudUpload size={18} />云备份与恢复</h2>
      <p className="mt-2 text-sm leading-6 text-neutral-600">连接飞牛 NAS 或其他 WebDAV 存储。云端保存加密的完整备份，包含数据库、图片、附件和应用配置。</p>
      <fieldset disabled={loading || Boolean(busy)} className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm text-neutral-700">WebDAV 地址<input type="url" value={settings.endpoint} onChange={event => edit("endpoint", event.target.value)} placeholder="https://nas.example.com/" className={inputClass} autoComplete="off" /></label>
        <label className="text-sm text-neutral-700">备份目录<input aria-label="备份目录" value={settings.directory} onChange={event => edit("directory", event.target.value)} placeholder="backup" className={inputClass} /><span className="mt-1 block text-xs text-neutral-500">相对于地址的目录；留空使用地址本身。飞牛可填写 backup。</span></label>
        <label className="text-sm text-neutral-700">WebDAV 账号<input value={settings.username} onChange={event => edit("username", event.target.value)} className={inputClass} autoComplete="off" /></label>
        <label className="text-sm text-neutral-700">WebDAV 密码<input type="password" value={password} onChange={event => { setPassword(event.target.value); setDirty(true); }} placeholder={settings.hasPassword ? "已保存，留空保留原密码" : "请输入密码"} className={inputClass} autoComplete="new-password" /></label>
        <label className="text-sm text-neutral-700">云端保留份数<input type="number" min={1} max={100} value={settings.keep} onChange={event => edit("keep", Number(event.target.value))} className={inputClass} /><span className="mt-1 block text-xs text-neutral-500">新备份校验成功后，仅清理相同网站标识的超额备份；其他网站和未标识的旧备份保留。</span></label>
        <label className="text-sm text-neutral-700">导入恢复密钥（换机恢复时填写）<input type="password" value={recoveryKey} onChange={event => { setRecoveryKey(event.target.value); setDirty(true); }} placeholder="粘贴之前导出的恢复密钥，平时留空" className={inputClass} autoComplete="new-password" /></label>
        <label className="flex items-center gap-2 text-sm text-neutral-700 sm:col-span-2"><input type="checkbox" checked={settings.dailyEnabled} onChange={event => edit("dailyEnabled", event.target.checked)} />每天自动备份到云端（跟随网站每日备份任务，服务器当地时间 04:17）</label>
      </fieldset>
      {settings.endpoint.startsWith("http:") && <p className="mt-3 text-xs text-amber-900">HTTP 会明文传输账号密码，请优先使用 HTTPS。</p>}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={loading || Boolean(busy) || (!dirty && configured)} className={buttonClass}>{saving ? "正在保存…" : "保存云备份配置"}</button>
        <button type="button" onClick={() => void start("test")} disabled={loading || Boolean(busy) || !configured || dirty} className={buttonClass}>测试连接</button>
        {configured && <a href={`${API}/key`} download className="text-sm text-neutral-700 underline underline-offset-4">导出恢复密钥</a>}
      </div>
      <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">恢复密钥请单独保存；服务器丢失后需要它解密云备份。导入其他密钥后，原密钥加密的备份需要原密钥才能恢复。地址和账号密码仅在后台管理。</p>
      <div aria-live="polite" className="mt-4 space-y-2 text-sm text-neutral-600">
        {loading && <p>正在读取云备份配置…</p>}
        {task?.status === "running" && <p className="flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />{PHASES[task.phase]}…{task.phase === "safety" || task.phase === "restore" ? "网站暂时处于恢复维护状态。" : "可以继续浏览网站，刷新后进度会保留。"}</p>}
        {uploading && <div className="space-y-2 rounded-lg bg-neutral-50 p-3">
          <p>上传进度 {Math.min(100, transfer.transferredBytes / transfer.totalBytes * 100).toFixed(1)}%</p>
          <progress aria-label="云备份上传进度" value={transfer.transferredBytes} max={transfer.totalBytes} className="h-2 w-full accent-neutral-900" />
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
            <span>已发送 {formatSize(transfer.transferredBytes)} / {formatSize(transfer.totalBytes)}</span>
            <span>平均速度 {formatSize(transfer.bytesPerSecond)}/s</span>
            <span>{transfer.transferredBytes >= transfer.totalBytes ? "等待上传确认…" : `预计剩余 ${formatRemaining(transfer.remainingSeconds)}`}</span>
          </div>
          <p className="text-xs text-neutral-500">速度和剩余时间为估算；上传后还需回读校验。刷新页面可继续查看进度。</p>
        </div>}
        {transfer && !uploading && <p className="text-xs text-neutral-500">备份包大小：{formatSize(transfer.totalBytes)}</p>}
        {task?.status === "failed" && <p role="alert" className="text-red-600">{task.error}</p>}
        {task?.status === "completed" && task.kind === "test" && <p className="flex items-center gap-2 text-green-700"><ShieldCheck size={16} />连接测试通过：目录列出、写入、读回和清理均成功。</p>}
        {task?.status === "completed" && task.kind === "backup" && <p className="text-green-700">云备份完成，远程回读校验通过。</p>}
        {task?.warning && <p className="text-amber-800">{task.warning}</p>}
        {message && <p>{message}</p>}
        {error && <p role="alert" className="text-red-600">{error}</p>}
        {restored && <Link href="/admin/login" className="inline-block underline underline-offset-4">重新登录后台</Link>}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => void start("backup")} disabled={loading || Boolean(busy) || !configured || dirty} className="inline-flex items-center gap-2 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><CloudUpload size={16} />备份到云端</button>
        <button type="button" onClick={() => void list()} disabled={Boolean(busy) || listing || !configured || dirty} className={buttonClass}>{listing ? "正在读取…" : "刷新云备份列表"}</button>
      </div>
      {configured && <div className="mt-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-neutral-900">选择备份恢复</h3>
          <button type="button" onClick={() => setOtherSites(current => !current)} className={buttonClass}>{otherSites ? "返回本站备份" : "浏览其他备份"}</button>
        </div>
        <p className="mt-2 text-xs text-neutral-600">{otherSites ? "其他网站及未标识的旧备份" : `当前网站：${settings.siteLabel}`} · {visibleFiles.length} 份备份</p>
        <p className="mt-1 text-xs leading-5 text-neutral-600">点击“恢复此备份”先校验并预览内容，再确认恢复。下载备份为原始加密包，恢复时需要对应密钥。</p>
        <ul className="mt-2 divide-y divide-neutral-100">
          {visibleFiles.map(file => <li key={file.name} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="text-sm text-neutral-800">{new Date(file.createdAt).toLocaleString("zh-CN")} · {(file.sizeBytes / 1024 / 1024).toFixed(2)} MB</p>
              <p className="mt-1 break-all text-xs text-neutral-600">网站：{file.site || "旧备份（未记录网站）"}</p>
              <p className="mt-1 break-all text-xs text-neutral-500">{file.name}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a href={`${API}/files/download?name=${encodeURIComponent(file.name)}`} download aria-label={`下载备份 ${file.name}`} className={`inline-flex items-center gap-2 ${buttonClass}`}><Download size={16} />下载备份</a>
              <button type="button" disabled={Boolean(busy) || dirty} onClick={() => void start("prepare", file.name)} className={`inline-flex items-center gap-2 ${buttonClass}`} aria-label={`恢复此备份 ${file.name}`}>
                <RotateCcw size={16} />恢复此备份
              </button>
              <button type="button" disabled={Boolean(busy) || dirty} onClick={() => void remove(file)} className="inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50" aria-label={`删除备份 ${file.name}`}>
                <Trash2 size={16} />{deleting === file.name ? "正在删除…" : "删除"}
              </button>
            </div>
          </li>)}
        </ul>
        {!listing && visibleFiles.length === 0 && <p className="mt-3 text-sm text-neutral-500">{otherSites ? "没有其他网站的备份。" : "暂无本站备份，可创建云备份，或点击“浏览其他备份”查看旧备份和其他网站备份。"}</p>}
      </div>}
      {ready && <div className="mt-5 rounded-xl border border-neutral-200 bg-neutral-50 p-4">
        <h3 className="text-sm font-semibold text-neutral-900">恢复预览 · 校验通过</h3>
        <p className="mt-2 break-all text-xs text-neutral-500">{task.name}</p>
        <p className="mt-2 text-sm text-neutral-700">{task.preview!.posts} 篇文章 · {task.preview!.moments} 条动态 · {task.preview!.attachments} 个附件 · {task.preview!.files} 个数据文件</p>
        <p className="mt-2 text-xs leading-5 text-neutral-600">恢复会覆盖当前数据库和持久化文件。执行前自动保存当前完整备份，执行期间网站进入维护状态，成功后需重新登录。云端连接设置、服务器路径与 PM2 配置保留；{task.preview!.configurationFiles} 个配置文件包含在完整下载包中，迁移机器时请核对后恢复。校验预览有效期为 30 分钟。</p>
        <a href={`${API}/download?id=${encodeURIComponent(task.id)}`} download className="mt-3 inline-block text-sm text-neutral-700 underline underline-offset-4">下载完整包（含配置，解密后未加密，请妥善保存）</a>
        <label className="mt-4 block text-sm text-neutral-700">填写“恢复数据”确认覆盖<input value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={Boolean(busy)} className={inputClass} autoComplete="off" /></label>
        <button type="button" onClick={() => void restore()} disabled={Boolean(busy) || dirty || confirmation !== "恢复数据"} className="mt-3 rounded-lg bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{restoring ? "正在恢复…" : "确认恢复数据库与文件"}</button>
      </div>}
      {task?.safetyBackup && <a href={`${API}/download?safety=${encodeURIComponent(task.id)}`} download className="mt-4 inline-block text-sm text-neutral-700 underline underline-offset-4">下载恢复前的完整备份</a>}
    </section>
  );
}
