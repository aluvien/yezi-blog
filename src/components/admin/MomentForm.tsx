"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMomentAction, updateMomentAction } from "@/lib/actions/moments";
import type { Moment } from "@/lib/db";
import { uploadImage } from "./ImageUpload";

const MAX_IMAGES = 9;

function initialImages(moment?: Moment): string[] {
  if (!moment) return [];
  try {
    const value = JSON.parse(moment.images) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export default function MomentForm({ moment }: { moment?: Moment }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState(moment?.content ?? "");
  const [images, setImages] = useState<string[]>(() => initialImages(moment));
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    setError("");
    try {
      const available = Math.max(0, MAX_IMAGES - images.length);
      for (const file of Array.from(files).slice(0, available)) {
        const path = await uploadImage(file);
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, path]));
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
    startTransition(async () => {
      const r = moment
        ? await updateMomentAction(moment.id, { content, images })
        : await createMomentAction({ content, images });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/admin/moments");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base leading-6"
        placeholder="记录一个想法…"
      />
      <div>
        <div className="grid grid-cols-3 gap-2">
          {images.map((src, i) => (
            <div key={`${src}-${i}`} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`图片 ${i + 1}`} className="aspect-square w-full rounded-lg border border-neutral-200 object-cover" />
              <button
                type="button"
                onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-xs text-white"
                aria-label="移除图片"
              >
                ×
              </button>
            </div>
          ))}
          {images.length < MAX_IMAGES && (
            <button
              type="button"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
              className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-neutral-300 text-sm text-neutral-400 active:bg-neutral-50"
            >
              {uploading ? "上传中…" : "+ 图片"}
            </button>
          )}
        </div>
        <p className="mt-1 text-xs text-neutral-400">最多 {MAX_IMAGES} 张，已选 {images.length} 张</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={pending || uploading}
        onClick={submit}
        className="rounded-lg bg-neutral-900 py-3 text-base font-medium text-white active:bg-neutral-700 disabled:opacity-50"
      >
        {pending ? "保存中…" : moment ? "保存修改" : "发布"}
      </button>
    </div>
  );
}
