"use client";

import { useState } from "react";
import { MUSIC_SERVERS, MUSIC_TYPES, parseMusicSpec } from "@/lib/music";

/** 音乐插入对话框：选择平台/ID/类型，返回 spec 字符串（如 netease:123:playlist），取消返回 null。 */
export function MusicInsertDialog({ onClose }: { onClose: (spec: string | null) => void }) {
  const [server, setServer] = useState<string>(MUSIC_SERVERS[0]);
  const [id, setId] = useState("");
  const [type, setType] = useState<string>(MUSIC_TYPES[0]);
  const [error, setError] = useState("");

  function confirm() {
    const spec = `${server}:${id.trim()}:${type}`;
    if (!parseMusicSpec(spec)) {
      setError("ID 需为数字");
      return;
    }
    onClose(spec);
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
          <h2 className="text-base font-semibold text-neutral-900">插入音乐</h2>
          <button
            type="button"
            aria-label="关闭对话框"
            onClick={() => onClose(null)}
            className="rounded-full p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            ×
          </button>
        </div>
        <div className="mt-4 flex flex-col gap-3">
          <label className="text-sm text-neutral-700">
            平台
            <select value={server} onChange={(event) => setServer(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
              {MUSIC_SERVERS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-neutral-700">
            ID
            <input value={id} onChange={(event) => { setId(event.target.value); setError(""); }} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="歌曲或歌单 ID" />
          </label>
          <label className="text-sm text-neutral-700">
            类型
            <select value={type} onChange={(event) => setType(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
              {MUSIC_TYPES.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </select>
          </label>
          <p className="text-xs text-neutral-400">单曲选 song，整个歌单选 playlist。ID 可在网易云/QQ 分享链接中找到。</p>
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
