"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createWorkAction, updateWorkAction } from "@/lib/actions/works";
import type { Work } from "@/lib/db";
import ImageUpload from "./ImageUpload";

export default function WorkForm({ work }: { work?: Work }) {
  const router = useRouter();
  const [title, setTitle] = useState(work?.title ?? "");
  const [description, setDescription] = useState(work?.description ?? "");
  const [link, setLink] = useState(work?.link ?? "");
  const [sortOrder, setSortOrder] = useState(String(work?.sort_order ?? 0));
  const [cover, setCover] = useState<string | null>(work?.cover ?? null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function submit() {
    setError("");
    startTransition(async () => {
      const data = {
        title,
        description,
        link,
        cover,
        sort_order: Number.parseInt(sortOrder, 10) || 0,
      };
      const r = work ? await updateWorkAction(work.id, data) : await createWorkAction(data);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/admin/works");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">标题</label>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
          placeholder="作品名称"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">描述</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base leading-6"
          placeholder="一句话介绍这个作品"
        />
      </div>
      <ImageUpload value={cover} onChange={setCover} label="封面图（可空）" />
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">链接（可空）</label>
        <input
          value={link}
          onChange={(e) => setLink(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
          placeholder="https://…"
          inputMode="url"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium text-neutral-700">排序（越小越靠前）</label>
        <input
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
          inputMode="numeric"
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="rounded-lg bg-neutral-900 py-3 text-base font-medium text-white active:bg-neutral-700 disabled:opacity-50"
      >
        {pending ? "保存中…" : work ? "保存修改" : "添加作品"}
      </button>
    </div>
  );
}
