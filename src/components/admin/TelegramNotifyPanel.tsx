"use client";

import { useCallback, useEffect, useState } from "react";
import { ADMIN_CSRF_HEADER } from "@/lib/client-security";

type Status = {
  configured: boolean;
  qqMusic: { status?: string; label?: string; lastCheckedAt: string | null; lastDetail: string | null; lastNotifiedAt: string | null };
};

type Props = {
  healthCheckEnabled: boolean;
  healthCheckIntervalHours: string;
  onHealthCheckEnabledChange: (enabled: boolean) => void;
  onHealthCheckIntervalHoursChange: (hours: string) => void;
  commentNotificationsEnabled: boolean;
  onCommentNotificationsEnabledChange: (enabled: boolean) => void;
};

async function api<T>(init?: RequestInit): Promise<T> {
  const response = await fetch("/api/admin/telegram", {
    ...init,
    headers: { ...ADMIN_CSRF_HEADER, ...Object.fromEntries(new Headers(init?.headers).entries()) },
    cache: "no-store",
  });
  const data = await response.json() as T & { error?: unknown };
  if (!response.ok || typeof data.error === "string") throw new Error(typeof data.error === "string" ? data.error : "请求失败");
  return data;
}

function formatTime(value: string | null): string {
  if (!value) return "尚未检测";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "尚未检测" : date.toLocaleString("zh-CN", { hour12: false });
}

export default function TelegramNotifyPanel({
  healthCheckEnabled,
  healthCheckIntervalHours,
  onHealthCheckEnabledChange,
  onHealthCheckIntervalHoursChange,
  commentNotificationsEnabled,
  onCommentNotificationsEnabledChange,
}: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<"test" | "check" | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<Status>());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法读取通知状态");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  async function run(op: "test" | "check") {
    setBusy(op);
    setMessage("");
    try {
      const result = await api<{ message?: string; label?: string; detail?: string; notified?: boolean }>({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op }),
      });
      if (op === "check") {
        setMessage(`QQ 音乐：${result.label ?? "已检测"}${result.detail ? ` · ${result.detail}` : ""}${result.notified ? "（已发送提醒）" : ""}`);
      } else {
        setMessage(result.message ?? "测试通知已发送，请查看 Telegram");
      }
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-800">Telegram 通知</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">新评论会即时提醒；QQ 音乐则由服务器定时验证真实播放授权。Bot Token 与 Chat ID 仅从服务器环境变量读取。</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs ${status?.configured ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-600"}`}>
          {status === null ? "检查中…" : status.configured ? "已配置" : "未配置"}
        </span>
      </div>

      <div className="mt-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs leading-5 text-neutral-600">
        <p>QQ 音乐：{status?.qqMusic.label ?? "尚未检测"}</p>
        <p className="text-neutral-400">上次检测：{formatTime(status?.qqMusic.lastCheckedAt ?? null)}</p>
        {status?.qqMusic.lastDetail && <p className="mt-1 text-neutral-500">诊断：{status.qqMusic.lastDetail}</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-neutral-700">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={healthCheckEnabled}
            onChange={(event) => onHealthCheckEnabledChange(event.target.checked)}
            className="h-4 w-4 accent-neutral-700"
          />
          博客内置定时检测
        </label>
        <label className="flex items-center gap-2 text-xs text-neutral-500">
          每
          <select
            value={healthCheckIntervalHours}
            disabled={!healthCheckEnabled}
            onChange={(event) => onHealthCheckIntervalHoursChange(event.target.value)}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-700 disabled:bg-neutral-100"
          >
            <option value="1">1 小时</option>
            <option value="6">6 小时</option>
            <option value="12">12 小时</option>
            <option value="24">24 小时</option>
          </select>
          检测一次
        </label>
      </div>
      <p className="mt-1.5 text-xs leading-5 text-neutral-400">保存设置后立即生效；博客 Node 进程重启时会自动恢复，不依赖宝塔计划任务。</p>

      <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
        <input
          type="checkbox"
          checked={commentNotificationsEnabled}
          onChange={(event) => onCommentNotificationsEnabledChange(event.target.checked)}
          className="h-4 w-4 accent-neutral-700"
        />
        新评论推送 Telegram（可在消息内直接通过或回复并通过）
      </label>
      <p className="mt-1.5 text-xs leading-5 text-neutral-400">向 Bot 发送 <code>/qqlogin</code> 可获取 QQ 音乐授权二维码；点击“回复并通过”后，直接发送回复内容即可。</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy !== null} onClick={() => void run("test")} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {busy === "test" ? "发送中…" : "发送测试通知"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => void run("check")} className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:opacity-50">
          {busy === "check" ? "检测中…" : "立即检测 QQ 音乐"}
        </button>
      </div>
      {message && <p className="mt-3 text-xs leading-5 text-neutral-500">{message}</p>}
      {!status?.configured && status !== null && <p className="mt-3 text-xs leading-5 text-amber-700">请先在服务器 `.env.local` 配置 `TELEGRAM_BOT_TOKEN` 与 `TELEGRAM_CHAT_ID`，保存后重启博客服务。</p>}
    </section>
  );
}
