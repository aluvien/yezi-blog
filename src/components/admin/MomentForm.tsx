"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMomentAction, updateMomentAction } from "@/lib/actions/moments";
import type { Moment } from "@/lib/db";
import { uploadImage } from "./ImageUpload";
import { MusicInsertDialog } from "./MusicInsertDialog";
import { parsePostTags } from "@/lib/post-tags";

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

export default function MomentForm({ moment, onSuccess, onCancel, compact, uploadEndpoint = "/api/admin/upload" }: { moment?: Moment; onSuccess?: () => void; onCancel?: () => void; compact?: boolean; uploadEndpoint?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState(moment?.content ?? "");
  const [tags, setTags] = useState(() => parsePostTags(moment?.tags).join(", "));
  const [images, setImages] = useState<string[]>(() => initialImages(moment));
  const [location, setLocation] = useState(moment?.location ?? "");
  const [original, setOriginal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState("");
  const [musicDialog, setMusicDialog] = useState(false);
  const [pending, startTransition] = useTransition();

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    setUploading(true);
    setError("");
    try {
      const available = Math.max(0, MAX_IMAGES - images.length);
      for (const file of Array.from(files).slice(0, available)) {
        const path = await uploadImage(file, original, uploadEndpoint);
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, path]));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "上传失败");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function insertMomentMusic(spec: string) {
    setContent((current) => {
      const prefix = current && !current.endsWith("\n") ? "\n" : "";
      return `${current}${prefix}!music ${spec}\n`;
    });
  }

  function useCurrentLocation() {
    if (typeof window === "undefined" || !window.navigator.geolocation) {
      setError("当前浏览器不支持定位，请手动填写城市");
      return;
    }
    const secureContext = window.isSecureContext ?? window.location.protocol === "https:";
    if (!secureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
      setError("定位需要在 HTTPS 页面中使用，请手动填写城市");
      return;
    }
    setLocating(true);
    setError("");
    window.navigator.geolocation.getCurrentPosition(
      async ({ coords }) => {
        try {
          const response = await fetch("/api/admin/moments/reverse-geocode", {
            method: "POST",
            cache: "no-store",
            credentials: "same-origin",
            headers: { "content-type": "application/json", "x-yezi-csrf": "1" },
            // 精确坐标放进 POST 请求体，避免进入浏览器 URL、应用与代理的访问日志。
            body: JSON.stringify({ lat: coords.latitude, lng: coords.longitude }),
          });
          const data = await response.json() as { location?: unknown; error?: unknown };
          if (!response.ok || typeof data.location !== "string" || !data.location.trim()) {
            if (response.status === 401) throw new Error("登录状态已失效，请刷新页面后重试");
            throw new Error(typeof data.error === "string" ? data.error : "未能识别所在地级市，请手动填写");
          }
          setLocation(data.location);
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "定位服务暂不可用，请手动填写城市");
        } finally {
          setLocating(false);
        }
      },
      (reason) => {
        setLocating(false);
        setError(
          reason.code === reason.PERMISSION_DENIED
            ? "未获得定位权限，请在浏览器设置中允许本站定位后重试"
            : reason.code === reason.TIMEOUT
              ? "定位超时，请检查系统定位服务后重试"
              : "无法获取当前位置，请手动填写城市",
        );
      },
      { enableHighAccuracy: false, timeout: 12_000, maximumAge: 5 * 60_000 },
    );
  }

  function submit() {
    setError("");
    startTransition(async () => {
      const r = moment
        ? await updateMomentAction(moment.id, { content, images, tags: parsePostTags(tags), location })
        : await createMomentAction({ content, images, tags: parsePostTags(tags), location });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      if (onSuccess) {
        onSuccess();
        router.refresh();
      } else {
        router.push("/admin/moments");
        router.refresh();
      }
    });
  }

  if (compact) {
    return (
      <div className="flex flex-col gap-2">
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm leading-6 resize-y"
          placeholder="记录一个絮语…"
        />
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          placeholder="标签（可选，多个用逗号分隔）"
          aria-label="絮语标签"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={location}
            onChange={(event) => { setLocation(event.target.value); setError(""); }}
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            placeholder="位置（可选，如杭州市）"
            aria-label="絮语位置"
          />
          <button type="button" onClick={useCurrentLocation} disabled={locating} className="rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">
            {locating ? "定位中…" : "使用现在位置"}
          </button>
        </div>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={`${src}-${i}`} className="relative h-14 w-14">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`图片 ${i + 1}`} className="h-14 w-14 rounded-md border border-neutral-200 object-cover" />
                <button
                  type="button"
                  onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-[10px] text-white"
                  aria-label="移除图片"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-neutral-400">{images.length > 0 ? `${images.length}/${MAX_IMAGES}` : ""}</span>
            <div className="flex items-center gap-2">
              <label className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-500">
                <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} className="h-3.5 w-3.5 accent-neutral-700" />
                保留原图
              </label>
              <button
              type="button"
              disabled={uploading || images.length >= MAX_IMAGES}
              onClick={() => inputRef.current?.click()}
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              {uploading ? "上传中…" : "+ 图片"}
            </button>
            <button
              type="button"
              onClick={() => setMusicDialog(true)}
              className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50"
            >
              + 音乐
            </button>
            {moment && onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                取消
              </button>
            )}
            <button
              type="button"
              disabled={pending || uploading}
              onClick={submit}
              className="rounded-md bg-neutral-900 px-4 py-1 text-sm font-medium text-white disabled:opacity-50"
            >
              {pending ? "保存中…" : moment ? "保存" : "发布"}
            </button>
          </div>
        </div>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        {musicDialog && (
          <MusicInsertDialog
            allowFolded
            onClose={(spec) => {
              setMusicDialog(false);
              if (spec) insertMomentMusic(spec);
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base leading-6"
        placeholder="记录一个絮语…"
      />
      <input
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
        placeholder="标签（可选，多个用逗号分隔）"
        aria-label="絮语标签"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={location}
          onChange={(event) => { setLocation(event.target.value); setError(""); }}
          className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-base"
          placeholder="位置（可选，如杭州市）"
          aria-label="絮语位置"
        />
        <button type="button" onClick={useCurrentLocation} disabled={locating} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-50 disabled:opacity-50">
          {locating ? "定位中…" : "使用现在位置"}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMusicDialog(true)}
          className="rounded-md border border-neutral-300 px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-50"
        >
          + 音乐
        </button>
      </div>
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
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
          <span>最多 {MAX_IMAGES} 张，已选 {images.length} 张</span>
          <label className="flex cursor-pointer items-center gap-1.5 text-neutral-500">
            <input type="checkbox" checked={original} onChange={(e) => setOriginal(e.target.checked)} className="h-3.5 w-3.5 accent-neutral-700" />
            保留原图（不压缩）
          </label>
        </div>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
      </div>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={pending || uploading}
        onClick={submit}
        className="rounded-lg bg-neutral-900 py-3 text-base font-medium text-white active:bg-neutral-700 disabled:opacity-50"
      >
        {pending ? "保存中…" : moment ? "保存修改" : "发布"}
      </button>
      {musicDialog && (
        <MusicInsertDialog
          allowFolded
          onClose={(spec) => {
            setMusicDialog(false);
            if (spec) insertMomentMusic(spec);
          }}
        />
      )}
    </div>
  );
}
