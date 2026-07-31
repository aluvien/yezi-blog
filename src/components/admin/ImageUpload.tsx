"use client";

import { useRef, useState } from "react";

export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "上传失败");
  return data.path as string;
}

/** 单图上传：显示缩略图，可更换/移除 */
export default function ImageUpload({
  value,
  onChange,
  label = "封面图",
}: {
  value: string | null;
  onChange: (path: string | null) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      onChange(await uploadImage(file));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-neutral-700">{label}</span>
      {value ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="封面" className="h-20 w-20 rounded-lg border border-neutral-200 object-cover" />
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="text-sm text-neutral-600 underline"
            >
              更换
            </button>
            <button type="button" onClick={() => onChange(null)} className="text-sm text-red-600 underline">
              移除
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-500 active:bg-neutral-50"
        >
          {uploading ? "上传中…" : "+ 上传图片"}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
    </div>
  );
}
