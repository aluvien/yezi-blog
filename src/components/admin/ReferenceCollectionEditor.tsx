"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReferenceTargetType } from "@/lib/db";
import { updateReferenceCollectionAction } from "@/lib/actions/references";

const STATUS_LABELS: Record<string, string> = { inbox: "待读", read: "已读", archived: "已归档" };

/** 收藏备注 / 状态 / 收藏标记的局部编辑；分类与标签仍由上方的既有表单维护，互不覆盖。 */
export default function ReferenceCollectionEditor({
  referenceId,
  initialNote,
  initialStatus,
  initialFavorite,
  savedAt,
  relationCounts,
}: {
  referenceId: number;
  initialNote: string;
  initialStatus: string;
  initialFavorite: boolean;
  savedAt: string | null;
  relationCounts: Record<ReferenceTargetType, number>;
}) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote);
  const [status, setStatus] = useState(initialStatus);
  const [favorite, setFavorite] = useState(initialFavorite);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    setError("");
    startTransition(async () => {
      const r = await updateReferenceCollectionAction(referenceId, { note, status, favorite });
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const relationParts = (["post", "life_event", "work", "github_repository"] as const)
    .map((type) => ({ type, count: relationCounts[type] }))
    .filter((item) => item.count > 0);

  return (
    <div className="admin-reference-collection mt-3 flex flex-col gap-2.5 rounded-xl bg-neutral-50 p-3">
      <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
        <label htmlFor={`ref-fav-${referenceId}`} className="flex cursor-pointer items-center gap-1.5">
          <input id={`ref-fav-${referenceId}`} type="checkbox" checked={favorite} onChange={(e) => setFavorite(e.target.checked)} className="h-3.5 w-3.5 accent-amber-500" />
          <span>{favorite ? "★ 已收藏" : "☆ 收藏"}</span>
        </label>
        <label htmlFor={`ref-status-${referenceId}`} className="flex items-center gap-1.5">
          状态
          <select id={`ref-status-${referenceId}`} value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs">
            {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <span>收藏于 {savedAt ? savedAt.slice(0, 10) : "—"}</span>
        <span className="ml-auto">
          关联内容：
          {relationParts.length > 0
            ? relationParts.map((item) => <span key={item.type} className="ml-1.5">{RELATION_LABEL[item.type]} {item.count}</span>)
            : <span className="text-neutral-400">无</span>}
        </span>
      </div>
      <div>
        <label htmlFor={`ref-note-${referenceId}`} className="mb-1 block text-xs text-neutral-400">收藏备注（为什么保存 / 准备怎么用）</label>
        <textarea
          id={`ref-note-${referenceId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="例如：博客升级 Next.js 16 缓存体系时重点参考。"
          className="w-full rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs leading-5 text-neutral-700 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
      </div>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end">
        <button type="button" disabled={pending} onClick={save} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-50">
          {pending ? "保存中…" : "保存收藏信息"}
        </button>
      </div>
    </div>
  );
}

const RELATION_LABEL: Record<ReferenceTargetType, string> = {
  post: "文章",
  life_event: "生活节点",
  work: "作品",
  github_repository: "GitHub",
};
