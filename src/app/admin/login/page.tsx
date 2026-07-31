"use client";

import { useState } from "react";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || !password) return;
    setError("");
    setPending(true);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error || "登录失败，请检查密码");
        return;
      }
      window.location.assign("/admin");
    } catch {
      setError("无法连接后台服务，请确认网站服务正在运行");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-neutral-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-7 shadow-sm">
        <h1 className="text-center text-xl font-bold">后台登录</h1>
        <p className="mt-2 text-center text-sm text-neutral-500">请输入 .env.local 中配置的 ADMIN_PASSWORD</p>
        <label htmlFor="admin-password" className="mt-6 block text-sm font-medium text-neutral-700">管理员密码</label>
        <input
          id="admin-password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="管理员密码"
          autoComplete="current-password"
          autoFocus
          required
          className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-base outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100"
        />
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={pending || !password}
          className="mt-5 w-full rounded-lg bg-neutral-900 py-2.5 text-base font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "正在登录…" : "进入后台"}
        </button>
      </form>
    </main>
  );
}
