"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createWorkAction, updateWorkAction } from "@/lib/actions/works";
import type { GithubRepository, Work } from "@/lib/db";
import { githubDisplayTitle } from "@/lib/github-presentation";
import ImageUpload from "./ImageUpload";

export default function WorkForm({
  work,
  repositories = [],
  initialRepositoryIds = [],
}: {
  work?: Work;
  repositories?: GithubRepository[];
  initialRepositoryIds?: number[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(work?.title ?? "");
  const [description, setDescription] = useState(work?.description ?? "");
  const [link, setLink] = useState(work?.link ?? "");
  const [sortOrder, setSortOrder] = useState(String(work?.sort_order ?? 0));
  const [cover, setCover] = useState<string | null>(work?.cover ?? null);
  const [selectedRepos, setSelectedRepos] = useState<Set<number>>(() => new Set(initialRepositoryIds));
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function toggleRepo(id: number) {
    setSelectedRepos((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const data = {
        title,
        description,
        link,
        cover,
        sort_order: Number.parseInt(sortOrder, 10) || 0,
        repository_ids: [...selectedRepos],
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
        <label htmlFor="work-title" className="mb-1 block text-sm font-medium text-neutral-700">标题</label>
        <input id="work-title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" placeholder="作品名称" />
      </div>
      <div>
        <label htmlFor="work-desc" className="mb-1 block text-sm font-medium text-neutral-700">描述</label>
        <textarea id="work-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base leading-6" placeholder="一句话介绍这个作品" />
      </div>
      <ImageUpload value={cover} onChange={setCover} label="封面图（可空）" />
      <div>
        <label htmlFor="work-link" className="mb-1 block text-sm font-medium text-neutral-700">链接（可空）</label>
        <input id="work-link" value={link} onChange={(e) => setLink(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" placeholder="https://…" inputMode="url" />
      </div>
      <div>
        <label htmlFor="work-sort" className="mb-1 block text-sm font-medium text-neutral-700">排序（越小越靠前）</label>
        <input id="work-sort" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" inputMode="numeric" />
      </div>

      <fieldset className="rounded-lg border border-neutral-200 p-3">
        <legend className="px-1 text-sm font-medium text-neutral-700">关联 GitHub 仓库（可多选）</legend>
        {repositories.length === 0 ? (
          <p className="text-sm text-neutral-400">还没有登记 GitHub 仓库。可先到 <Link href="/admin/life/github" className="text-blue-700 underline">小记 · GitHub</Link> 登记。</p>
        ) : (
          <div className="flex max-h-60 flex-col gap-1 overflow-y-auto">
            {repositories.map((repo) => (
              <label key={repo.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-neutral-50">
                <input type="checkbox" checked={selectedRepos.has(repo.id)} onChange={() => toggleRepo(repo.id)} className="h-4 w-4 accent-neutral-700" />
                <span className="min-w-0 truncate text-neutral-800">{githubDisplayTitle(repo)}</span>
                <span className="shrink-0 text-xs text-neutral-400">{repo.full_name}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
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
