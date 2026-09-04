"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createLifeEventAction,
  updateLifeEventAction,
  extractLifeEventFromMomentAction,
} from "@/lib/actions/life-events";
import type { LifeEventFormInput } from "@/lib/admin/life-events";
import type { LifeEvent } from "@/lib/db";
import { uploadImage } from "./ImageUpload";

const MAX_IMAGES = 9;

/**
 * 生活节点表单，三种模式共用：手动新建、编辑已有节点、以及从絮语提取（seed 预填 + momentId）。
 * 提取模式提交 extractLifeEventFromMomentAction，其余走 create/update；都不改动原絮语。
 */
export default function LifeEventForm({
  event,
  mode = "create",
  momentId,
  seed,
}: {
  event?: LifeEvent;
  mode?: "create" | "edit" | "extract";
  momentId?: number;
  seed?: LifeEventFormInput;
}) {
  const router = useRouter();
  const initial = event ? toFormInput(event) : seed ?? { title: "", content: "", occurred_at: "", date_precision: "day", cover: null, images: [], tags: [], location: "" };
  const [title, setTitle] = useState(initial.title);
  const [content, setContent] = useState(initial.content);
  const [occurredAt, setOccurredAt] = useState(initial.occurred_at);
  const [precision, setPrecision] = useState(initial.date_precision);
  const [tags, setTags] = useState(Array.isArray(initial.tags) ? initial.tags.join(", ") : "");
  const [location, setLocation] = useState(initial.location ?? "");
  const [cover, setCover] = useState<string | null>(initial.cover ?? null);
  const [images, setImages] = useState<string[]>(initial.images ?? []);
  const [original, setOriginal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  function insertAtCursor(text: string) {
    setContent((current) => (current && !current.endsWith("\n") ? `${current}\n${text}` : `${current}${text}`));
  }

  async function handleUpload(files: FileList | null, target: "cover" | "images") {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      if (target === "cover") {
        const path = await uploadImage(files[0], original);
        setCover(path);
      } else {
        const available = Math.max(0, MAX_IMAGES - images.length);
        for (const file of Array.from(files).slice(0, available)) {
          const path = await uploadImage(file, original);
          setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, path]));
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function submit() {
    setError("");
    const data: LifeEventFormInput = {
      title: title.trim(),
      content,
      occurred_at: occurredAt.trim(),
      date_precision: precision,
      cover,
      images,
      tags: tags.split(/[,，]/).map((t) => t.trim()).filter(Boolean),
      location,
    };
    startTransition(async () => {
      const r = mode === "edit" && event
        ? await updateLifeEventAction(event.id, data)
        : mode === "extract" && momentId
          ? await extractLifeEventFromMomentAction(momentId, data)
          : await createLifeEventAction(data);
      if (!r.ok) { setError(r.error); return; }
      router.push("/admin/life/milestones");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {mode === "extract" && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          从絮语提取：以下内容已按原絮语预填，可自由修改。保存后只新增生活节点，原絮语保持不变。
        </p>
      )}
      <div>
        <label htmlFor="le-title" className="mb-1 block text-sm font-medium text-neutral-700">标题</label>
        <input id="le-title" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" placeholder="这件事叫什么，如：第一个网站上线" />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="le-date" className="mb-1 block text-sm font-medium text-neutral-700">发生日期</label>
          <input id="le-date" value={occurredAt} onChange={(e) => setOccurredAt(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" placeholder="2002 / 2025-07 / 2026-09-03" inputMode="numeric" />
        </div>
        <div>
          <label htmlFor="le-precision" className="mb-1 block text-sm font-medium text-neutral-700">日期精度</label>
          <select id="le-precision" value={precision} onChange={(e) => setPrecision(e.target.value as LifeEventFormInput["date_precision"])} className="rounded-lg border border-neutral-300 px-3 py-2 text-base">
            <option value="day">精确到日</option>
            <option value="month">精确到月</option>
            <option value="year">精确到年</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="le-content" className="mb-1 block text-sm font-medium text-neutral-700">内容</label>
        <textarea id="le-content" value={content} onChange={(e) => setContent(e.target.value)} rows={5} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base leading-6" placeholder="补充这段经历的细节（支持 Markdown）" />
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => insertAtCursor("![图片说明](https://)")} className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50">插入链接/图片语法</button>
        </div>
      </div>
      <div>
        <label htmlFor="le-tags" className="mb-1 block text-sm font-medium text-neutral-700">标签（可选，逗号分隔）</label>
        <input id="le-tags" value={tags} onChange={(e) => setTags(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" placeholder="如：成长, 里程碑" />
      </div>
      <div>
        <label htmlFor="le-location" className="mb-1 block text-sm font-medium text-neutral-700">位置（可选）</label>
        <input id="le-location" value={location} onChange={(e) => setLocation(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" placeholder="如：杭州市" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="mb-1 block text-sm font-medium text-neutral-700">封面（可空）</p>
          {cover ? (
            <div className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={cover} alt="封面预览" className="aspect-[16/9] w-full rounded-lg border border-neutral-200 object-cover" />
              <button type="button" onClick={() => setCover(null)} className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs text-white" aria-label="移除封面">×</button>
              <CoverUploader original={original} onUploaded={setCover} />
            </div>
          ) : (
            <CoverUploader original={original} onUploaded={setCover} />
          )}
        </div>
        <div>
          <p className="mb-1 text-sm font-medium text-neutral-700">图片（最多 {MAX_IMAGES} 张）</p>
          <div className="grid grid-cols-3 gap-2">
            {images.map((src, i) => (
              <div key={`${src}-${i}`} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`图片 ${i + 1}`} className="aspect-square w-full rounded-lg border border-neutral-200 object-cover" />
                <button type="button" onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))} className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs text-white" aria-label="移除图片">×</button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-400 hover:bg-neutral-50">
                {uploading ? "上传中…" : "+ 图片"}
                <input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={uploading} onChange={(e) => handleUpload(e.target.files, "images")} />
              </label>
            )}
          </div>
          <label className="mt-1.5 flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} className="h-3.5 w-3.5 accent-neutral-700" />
            保留原图（不压缩）
          </label>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="button" disabled={pending || uploading} onClick={submit} className="rounded-lg bg-neutral-900 px-5 py-3 text-base font-medium text-white active:bg-neutral-700 disabled:opacity-50">
          {pending ? "保存中…" : mode === "extract" ? "创建生活节点" : mode === "edit" ? "保存修改" : "添加生活节点"}
        </button>
        <button type="button" onClick={() => router.push("/admin/life/milestones")} className="text-sm text-neutral-500 hover:text-neutral-700">取消</button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleUpload(e.target.files, "cover")} />
    </div>
  );
}

function CoverUploader({ original, onUploaded }: { original: boolean; onUploaded: (path: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="flex aspect-[16/9] w-full items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-400 hover:bg-neutral-50 disabled:opacity-50">
        {busy ? "上传中…" : "+ 上传封面"}
      </button>
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" disabled={busy} onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try { onUploaded(await uploadImage(file, original)); } finally { setBusy(false); if (ref.current) ref.current.value = ""; }
      }} />
    </>
  );
}

function toFormInput(event: LifeEvent): LifeEventFormInput {
  return {
    title: event.title,
    content: event.content,
    occurred_at: event.occurred_at,
    date_precision: event.date_precision,
    cover: event.cover,
    images: parseJsonArray(event.images),
    tags: parseJsonArray(event.tags),
    location: event.location,
  };
}

function parseJsonArray(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
