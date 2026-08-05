"use client";

import { useState } from "react";
import { parseVideoSpec, VIDEO_PLATFORMS, type VideoPlatform } from "@/lib/video";

/** 视频插入对话框：接受 Bilibili/YouTube 链接或视频 ID，返回规范化规格。 */
export function VideoInsertDialog({ onClose }: { onClose: (spec: string | null) => void }) {
  const [platform, setPlatform] = useState<VideoPlatform>(VIDEO_PLATFORMS[0]);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");

  function confirm() {
    const spec = parseVideoSpec(input, platform);
    if (!spec) {
      setError(platform === "bilibili" ? "请输入有效的 Bilibili 视频链接、BV 号或 av 号" : "请输入有效的 YouTube 视频链接或 11 位视频 ID");
      return;
    }
    const serialized = `${spec.platform}:${spec.id}${spec.page && spec.page > 1 ? `:${spec.page}` : ""}`;
    onClose(serialized);
  }

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-900/30 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(null);
      }}
    >
      <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-neutral-900">插入视频</h2>
          <button type="button" aria-label="关闭对话框" onClick={() => onClose(null)} className="rounded-full p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">×</button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <label className="text-sm text-neutral-700">
            平台
            <select value={platform} onChange={(event) => { setPlatform(event.target.value as VideoPlatform); setError(""); }} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
              <option value="bilibili">Bilibili</option>
              <option value="youtube">YouTube</option>
            </select>
          </label>
          <label className="text-sm text-neutral-700">
            视频链接或 ID
            <input
              value={input}
              onChange={(event) => { setInput(event.target.value); setError(""); }}
              className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              placeholder={platform === "bilibili" ? "BV号、av号或 bilibili.com/video 链接" : "YouTube 链接或 11 位视频 ID"}
              autoFocus
            />
          </label>
          <p className="text-xs leading-5 text-neutral-400">Bilibili 多 P 视频会自动读取链接中的 p 参数；YouTube 支持 watch、youtu.be、shorts 和 embed 链接。</p>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onClose(null)} className="rounded-lg border border-neutral-300 px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-50">取消</button>
          <button type="button" onClick={confirm} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700">插入</button>
        </div>
      </div>
    </div>
  );
}
