"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const router = useRouter();

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
      router.replace("/admin");
    } catch {
      setError("无法连接后台服务，请确认网站服务正在运行");
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="admin-login-page flex min-h-screen flex-col items-center justify-center bg-neutral-50 p-6">
      <form onSubmit={submit} className="admin-login-card w-full max-w-sm rounded-2xl bg-white p-7 shadow-sm">
        <h1 className="text-center text-xl font-bold">后台登录</h1>
        <p className="mt-2 text-center text-sm text-neutral-500">请输入管理员密码，登录后管理站点内容。</p>
        <label htmlFor="admin-password" className="mt-6 block text-sm font-medium text-neutral-700">管理员密码</label>
        <div className="relative mt-2">
          <input
            id="admin-password"
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="管理员密码"
            autoComplete="current-password"
            autoFocus
            required
            className="w-full rounded-lg border border-neutral-300 px-3 py-2.5 pr-16 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
          <button
            type="button"
            onClick={() => setShowPassword((value) => !value)}
            className="absolute inset-y-0 right-2 px-2 text-xs text-neutral-400 hover:text-accent"
          >
            {showPassword ? "隐藏" : "显示"}
          </button>
        </div>
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={pending || !password}
          className="admin-button admin-button-primary mt-5 w-full rounded-lg bg-neutral-900 py-2.5 text-base font-medium text-white transition-colors hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "正在登录…" : "进入后台"}
        </button>
      </form>
    </main>
  );
}
