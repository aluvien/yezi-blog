"use client";

import { useRef, useState } from "react";
import type { Attachment } from "@/lib/db";

/** 客户端 canvas 预压缩:大图 resize 到 maxDim,质量 quality(jpeg)。 */
async function resizeImage(file: File, maxDim: number, quality: number): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    if (width >= height) {
      height = Math.round((height * maxDim) / width);
      width = maxDim;
    } else {
      width = Math.round((width * maxDim) / height);
      height = maxDim;
    }
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(img, 0, 0, width, height);
  return await new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", quality);
  });
}

/** 上传图片:默认客户端 canvas 预压缩 + 服务端 sharp 精压;original=true 保留原图。返回 path。 */
async function uploadImageData(file: File, original = false, endpoint = "/api/admin/upload"): Promise<{ path: string; attachment?: Attachment }> {
  let uploadFile: Blob = file;
  if (!original && file.type.startsWith("image/") && file.type !== "image/gif") {
    try {
      uploadFile = await resizeImage(file, 1920, 0.85);
    } catch {
      uploadFile = file;
    }
  }
  const fd = new FormData();
  fd.append("file", uploadFile, file.name);
  fd.append("original", String(original));
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 60_000);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      body: fd,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new Error("上传超时，请检查网络后重试");
    }
    throw new Error("无法连接上传服务，请刷新页面后重试");
  } finally {
    window.clearTimeout(timeoutId);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "上传失败");
  return { path: data.path as string, attachment: data.attachment as Attachment | undefined };
}

export async function uploadImage(file: File, original = false, endpoint = "/api/admin/upload"): Promise<string> {
  return (await uploadImageData(file, original, endpoint)).path;
}

/** 单图上传:显示缩略图,可更换/移除,可勾选"保留原图"。 */
export default function ImageUpload({
  value,
  onChange,
  onAttachmentUploaded,
  label = "封面图",
  contain = false,
}: {
  value: string | null;
  onChange: (path: string | null) => void;
  onAttachmentUploaded?: (attachment: Attachment) => void;
  label?: string;
  contain?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [original, setOriginal] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await uploadImageData(file, original);
      onChange(uploaded.path);
      if (uploaded.attachment) onAttachmentUploaded?.(uploaded.attachment);
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
          <img src={value} alt="封面" className={`h-20 w-20 rounded-lg border border-neutral-200 ${contain ? "object-contain" : "object-cover"}`} />
          <div className="flex flex-col gap-1">
            <button type="button" onClick={() => inputRef.current?.click()} className="text-sm text-neutral-600 underline">更换</button>
            <button type="button" onClick={() => onChange(null)} className="text-sm text-red-600 underline">移除</button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="rounded-lg border border-dashed border-neutral-300 px-4 py-3 text-sm text-neutral-500 active:bg-neutral-50">
          {uploading ? "上传中…" : "+ 上传图片"}
        </button>
      )}
      <label className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
        <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} className="h-3.5 w-3.5 accent-neutral-700" />
        保留原图(不压缩)
      </label>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => handleFile(e.target.files?.[0])} />
    </div>
  );
}
