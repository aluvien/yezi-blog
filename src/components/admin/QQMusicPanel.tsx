"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Status = { available: boolean; loggedIn: boolean; uin: string | null };
type Qr = { image: string; qrsig: string; ptqrtoken: string };

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const data = await response.json() as T & { error?: unknown };
  if (!response.ok || typeof data.error === "string") throw new Error(typeof data.error === "string" ? data.error : "请求失败");
  return data;
}

/** QQ login is deliberately kept in site settings: it controls a server-only cookie. */
export default function QQMusicPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const pollingRef = useRef(false);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await api<Status>("/api/admin/qq-music?op=status"));
    } catch (error) {
      setStatus({ available: false, loggedIn: false, uin: null });
      setMessage(error instanceof Error ? error.message : "无法连接 QQ 音乐服务");
    }
  }, []);

  useEffect(() => {
    // Defer the first request one task so React does not synchronously cascade
    // a state update while mounting this settings form.
    const timer = window.setTimeout(() => { void refreshStatus(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    const poll = async () => {
      if (pollingRef.current || stopped) return;
      pollingRef.current = true;
      try {
        const result = await api<{ state?: string; uin?: string; message?: string }>("/api/admin/qq-music", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "poll", qrsig: qr.qrsig, ptqrtoken: qr.ptqrtoken }),
        });
        if (result.state === "success") {
          setStatus({ available: true, loggedIn: true, uin: result.uin ?? null });
          setMessage("QQ 音乐登录成功，会员权限已仅保存在服务器。");
          setQr(null);
        } else if (result.message) {
          setMessage(result.message);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "登录状态检查失败");
      } finally {
        pollingRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [qr]);

  async function openQr() {
    setBusy(true);
    setMessage("");
    try {
      setQr(await api<Qr>("/api/admin/qq-music?op=qr"));
      setMessage("请用手机 QQ 扫码，并在手机上确认登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成二维码");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-800">QQ 音乐账号</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            扫码后的 Cookie 仅保存在服务器受保护的会话文件中，不会存入网站数据库或下发给访客。
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs ${status?.loggedIn ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-600"}`}>
          {status === null ? "检查中…" : status.loggedIn ? `已登录${status.uin ? ` · ${status.uin}` : ""}` : status.available ? "尚未登录" : "服务未连接"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void openQr()} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {busy ? "生成中…" : status?.loggedIn ? "重新扫码登录" : "扫码登录 QQ 音乐"}
        </button>
        <button type="button" onClick={() => void refreshStatus()} className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
          刷新状态
        </button>
      </div>

      {qr && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-start">
          {/* QR data is returned only from the admin-protected route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.image} alt="QQ 音乐登录二维码" className="h-40 w-40 rounded-lg border border-neutral-100 object-contain" />
          <div className="text-center sm:text-left">
            <p className="text-sm font-medium text-neutral-800">请使用手机 QQ 扫码</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">二维码有效期有限。扫描后在 QQ 内确认，本页会自动完成登录。</p>
            <button type="button" onClick={() => setQr(null)} className="mt-3 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800">取消本次扫码</button>
          </div>
        </div>
      )}
      {message && <p className={`mt-3 text-xs leading-5 ${status?.available === false ? "text-red-600" : "text-neutral-500"}`}>{message}</p>}
    </div>
  );
}
