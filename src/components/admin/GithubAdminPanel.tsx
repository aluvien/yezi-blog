"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { GithubRepository } from "@/lib/db";
import { githubDisplayDescription, githubDisplayTitle, parseGithubTags } from "@/lib/github-presentation";
import {
  deleteGithubRepositoryAction,
  registerGithubRepositoryAction,
  syncAllGithubRepositoriesAction,
  syncGithubRepositoryAction,
  updateGithubRepositoryAction,
} from "@/lib/actions/github-repositories";
import { uploadImage } from "./ImageUpload";
import DeleteButton from "./DeleteButton";

function formatDate(value: string | null): string {
  return value ? value.slice(0, 10) : "—";
}

function StatusBadge({ repo }: { repo: GithubRepository }) {
  if (repo.sync_status === "error") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[11px] text-red-700" title={repo.sync_error}>同步失败</span>;
  }
  if (repo.sync_status === "success") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] text-green-700">已同步 {formatDate(repo.synced_at)}</span>;
  }
  return <span className="inline-flex items-center rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">未同步</span>;
}

function RepoRow({ repo, onError }: { repo: GithubRepository; onError: (message: string) => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [customTitle, setCustomTitle] = useState(repo.custom_title);
  const [customDescription, setCustomDescription] = useState(repo.custom_description);
  const [tags, setTags] = useState(parseGithubTags(repo).join(", "));
  const [featured, setFeatured] = useState(repo.featured === 1);
  const [cover, setCover] = useState<string | null>(repo.cover);
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();
  const coverRef = useRef<HTMLInputElement>(null);

  function save() {
    onError("");
    startTransition(async () => {
      const r = await updateGithubRepositoryAction(repo.id, {
        custom_title: customTitle,
        custom_description: customDescription,
        cover,
        tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
        featured,
      });
      if (!r.ok) { onError(r.error); return; }
      setEditing(false);
      router.refresh();
    });
  }

  function sync() {
    setBusy(true);
    startTransition(async () => {
      const r = await syncGithubRepositoryAction(repo.id);
      setBusy(false);
      if (!r.ok) onError(r.error);
      router.refresh();
    });
  }

  return (
    <li className="admin-card admin-content-card rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a href={repo.repo_url} target="_blank" rel="noopener noreferrer" className="text-base font-medium text-neutral-900 hover:text-accent">{githubDisplayTitle(repo)}</a>
            {repo.featured === 1 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">精选</span>}
            <StatusBadge repo={repo} />
            {repo.archived === 1 && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">已归档</span>}
          </div>
          <p className="mt-0.5 text-xs text-neutral-400" title={repo.full_name}>{repo.full_name} · 登记于 {formatDate(repo.registered_at)}</p>
          {githubDisplayDescription(repo) && <p className="mt-1 line-clamp-2 text-[13px] text-neutral-500">{githubDisplayDescription(repo)}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-neutral-400">
            {repo.primary_language && <span>{repo.primary_language}</span>}
            <span>★ {repo.stars}</span>
            <span>Fork {repo.forks}</span>
            {repo.pushed_at && <span>push {formatDate(repo.pushed_at)}</span>}
          </div>
          {repo.sync_status === "error" && repo.sync_error && <p className="mt-2 text-[12px] text-red-600">同步失败：{repo.sync_error}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          <button type="button" disabled={busy} onClick={sync} className="admin-action-link text-sm text-blue-700 hover:text-blue-900 disabled:opacity-50">{busy ? "同步中…" : "同步"}</button>
          <button type="button" onClick={() => setEditing((v) => !v)} className="admin-action-link text-sm text-neutral-700 hover:text-neutral-950">{editing ? "取消" : "编辑"}</button>
          <DeleteButton action={deleteGithubRepositoryAction.bind(null, repo.id)} confirmText="确定删除这个仓库登记？作品与它的关联会一并断开。" />
        </div>
      </div>

      {editing && (
        <div className="mt-4 flex flex-col gap-3 border-t border-neutral-100 pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">自定义标题（留空则用仓库名）</label>
              <input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-neutral-600">标签（逗号分隔）</label>
              <input value={tags} onChange={(e) => setTags(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-neutral-600">自定义描述（留空则用仓库简介）</label>
            <textarea value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-neutral-600">
              <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} className="h-4 w-4 accent-neutral-700" />
              标记为精选
            </label>
            <div className="flex items-center gap-2">
              {cover && (
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={cover} alt="封面" className="h-14 w-24 rounded-md border border-neutral-200 object-cover" />
                  <button type="button" onClick={() => setCover(null)} className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[10px] text-white" aria-label="移除封面">×</button>
                </div>
              )}
              <button type="button" disabled={busy} onClick={() => coverRef.current?.click()} className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50">{cover ? "换封面" : "+ 封面"}</button>
              <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try { setCover(await uploadImage(file)); } finally { setBusy(false); if (coverRef.current) coverRef.current.value = ""; }
              }} />
            </div>
            <button type="button" disabled={pending || busy} onClick={save} className="ml-auto rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "保存中…" : "保存修改"}</button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function GithubAdminPanel({ repositories }: { repositories: GithubRepository[] }) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [registering, startRegister] = useTransition();
  const [syncingAll, startSyncAll] = useTransition();

  function register() {
    setError("");
    startRegister(async () => {
      const r = await registerGithubRepositoryAction(input);
      if (!r.ok) { setError(r.error); return; }
      setInput("");
      router.refresh();
    });
  }

  function syncAll() {
    setError("");
    startSyncAll(async () => {
      const r = await syncAllGithubRepositoriesAction();
      if (!r.ok) { setError(r.error); return; }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(""); }}
            placeholder="https://github.com/owner/repo 或 owner/repo"
            aria-label="GitHub 仓库地址"
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-base"
          />
          <button type="button" disabled={registering} onClick={register} className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{registering ? "登记中…" : "登记仓库"}</button>
          <button type="button" disabled={syncingAll || repositories.length === 0} onClick={syncAll} className="rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">{syncingAll ? "同步中…" : `全部同步（${repositories.length}）`}</button>
        </div>
        {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
        <p className="mt-2 text-xs text-neutral-400">登记时会尽力同步一次元数据。前台只读数据库快照，不实时请求 GitHub；同步失败只影响这张表，不影响小记页面。</p>
      </div>

      {repositories.length === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-400">还没有登记 GitHub 仓库。</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {repositories.map((repo) => <RepoRow key={repo.id} repo={repo} onError={setError} />)}
        </ul>
      )}
    </div>
  );
}
