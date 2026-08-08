"use client";
/* eslint-disable @next/next/no-img-element -- QQ cover URLs are third-party and dynamic. */

import { useState } from "react";
import { MUSIC_SERVERS, MUSIC_TYPES, parseMusicSpec } from "@/lib/music";

type QQTrack = { mid: string; name: string; artist: string; album: string; cover: string };

/** 音乐插入对话框：选择平台/ID/类型/播放顺序，返回 spec 字符串。 */
export function MusicInsertDialog({ onClose }: { onClose: (spec: string | null) => void }) {
  const [server, setServer] = useState<string>(MUSIC_SERVERS[0]);
  const [id, setId] = useState("");
  const [type, setType] = useState<string>(MUSIC_TYPES[0]);
  const [shuffle, setShuffle] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"manual" | "qq">("manual");
  const [keyword, setKeyword] = useState("");
  const [tracks, setTracks] = useState<QQTrack[]>([]);
  const [searching, setSearching] = useState(false);

  function confirm() {
    const spec = `${server}:${id.trim()}:${type}${shuffle ? ":random" : ""}`;
    if (!parseMusicSpec(spec)) {
      setError("ID 需为数字");
      return;
    }
    onClose(spec);
  }

  async function searchQQ() {
    const query = keyword.trim();
    if (!query) return;
    setSearching(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/qq-music?op=search&q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const data = await response.json() as { tracks?: QQTrack[]; error?: unknown };
      if (!response.ok || typeof data.error === "string") throw new Error(typeof data.error === "string" ? data.error : "搜索失败");
      setTracks(Array.isArray(data.tracks) ? data.tracks : []);
      if (!data.tracks?.length) setError("没有找到匹配歌曲");
    } catch (reason) {
      setTracks([]);
      setError(reason instanceof Error ? reason.message : "搜索失败");
    } finally {
      setSearching(false);
    }
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
        <div className="mt-4 flex gap-2 border-b border-neutral-200 pb-3">
          <button type="button" onClick={() => setTab("manual")} className={`rounded-md px-3 py-1.5 text-sm ${tab === "manual" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>手动填写</button>
          <button type="button" onClick={() => setTab("qq")} className={`rounded-md px-3 py-1.5 text-sm ${tab === "qq" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>QQ 音乐搜索</button>
        </div>
        {tab === "manual" ? <div className="mt-4 flex flex-col gap-3">
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
          <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
            <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} className="h-4 w-4 accent-neutral-700" />
            随机播放歌单
          </label>
          <p className="text-xs text-neutral-400">单曲选 song，整个歌单选 playlist。ID 可在网易云/QQ 分享链接中找到。</p>
        </div> : <div className="mt-4">
          <p className="text-xs leading-5 text-neutral-500">使用设置页面已登录的 QQ 音乐账号搜索。选择后会插入可使用该账号权限播放的单曲。</p>
          <div className="mt-3 flex gap-2">
            <input value={keyword} onChange={(event) => { setKeyword(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchQQ(); } }} className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="歌名或歌手" />
            <button type="button" disabled={searching || !keyword.trim()} onClick={() => void searchQQ()} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50">{searching ? "搜索中…" : "搜索"}</button>
          </div>
          <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
            {tracks.map((track) => (
              <button key={track.mid} type="button" onClick={() => onClose(`qqvip:${track.mid}:song`)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-neutral-100">
                {track.cover ? <img src={track.cover} alt="" className="h-10 w-10 rounded-md bg-neutral-100 object-cover" /> : <span className="h-10 w-10 rounded-md bg-neutral-100" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-neutral-800">{track.name}</span>
                  <span className="mt-0.5 block truncate text-xs text-neutral-500">{[track.artist, track.album].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="text-xs text-neutral-400">插入</span>
              </button>
            ))}
          </div>
        </div>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {tab === "manual" && <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onClose(null)} className="rounded-lg border border-neutral-300 px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-50">取消</button>
          <button type="button" onClick={confirm} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700">插入</button>
        </div>}
      </div>
    </div>
  );
}
