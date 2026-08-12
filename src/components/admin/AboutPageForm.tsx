"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSiteSettingsAction } from "@/lib/actions/settings";

export default function AboutPageForm({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [content, setContent] = useState(initialValue);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    startTransition(async () => {
      const result = await updateSiteSettingsAction({ about_content: content });
      if (!result.ok) return setError(result.error);
      setMessage("关于页面已保存");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <section className="admin-card rounded-2xl bg-white p-5 shadow-sm sm:p-6">
        <label className="mb-2 block text-sm font-medium text-neutral-800">关于页内容</label>
        <p className="mb-3 text-xs leading-5 text-neutral-500">支持 Markdown；留空时前台显示默认关于内容。</p>
        <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={18} className="w-full rounded-xl border border-neutral-300 px-3 py-3 text-sm leading-7 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" placeholder="写一点关于自己的介绍…" />
      </section>
      <div className="admin-settings-savebar flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="admin-button admin-button-primary rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "保存中…" : "保存关于页面"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}
      </div>
    </form>
  );
}
