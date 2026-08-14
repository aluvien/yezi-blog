"use client";
/* eslint-disable @next/next/no-img-element -- QQ cover URLs are third-party and dynamic. */

import { useState } from "react";
import { createQQMusicSpec, MUSIC_TYPES, parseMusicSpec } from "@/lib/music";

type QQTrack = { mid: string; name: string; artist: string; album: string; cover: string };
type QQPlaylist = {
  id: string;
  name: string;
  creator: string;
  count: number | null;
  cover: string;
  kind: "created" | "collected" | "search";
};

/** QQ VIP 音乐插入对话框：支持歌曲/歌单搜索，也支持手动填写 ID。 */
export function MusicInsertDialog({ onClose }: { onClose: (spec: string | null) => void }) {
  const [id, setId] = useState("");
  const [type, setType] = useState<string>(MUSIC_TYPES[0]);
  const [shuffle, setShuffle] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"manual" | "qq">("qq");
  const [searchType, setSearchType] = useState<"song" | "playlist">("song");
  const [keyword, setKeyword] = useState("");
  const [tracks, setTracks] = useState<QQTrack[]>([]);
  const [playlists, setPlaylists] = useState<QQPlaylist[]>([]);
  const [searching, setSearching] = useState(false);

  function confirm() {
    const spec = `qqvip:${id.trim()}:${type}${shuffle ? ":random" : ""}`;
    if (!parseMusicSpec(spec)) {
      setError("请输入有效的 QQ 音乐 ID");
      return;
    }
    onClose(spec);
  }

  function changeSearchType(next: "song" | "playlist") {
    setSearchType(next);
    setTracks([]);
    setPlaylists([]);
    setError("");
  }

  async function searchQQ() {
    const query = keyword.trim();
    if (!query) return;
    setSearching(true);
    setError("");
    setTracks([]);
    setPlaylists([]);
    try {
      const response = await fetch(
        `/api/admin/qq-music?op=search&type=${searchType}&q=${encodeURIComponent(query)}`,
        { cache: "no-store" },
      );
      const data = await response.json() as { tracks?: QQTrack[]; playlists?: QQPlaylist[]; error?: unknown };
      if (!response.ok || typeof data.error === "string") {
        throw new Error(typeof data.error === "string" ? data.error : "搜索失败");
      }
      if (searchType === "playlist") {
        const next = Array.isArray(data.playlists) ? data.playlists : [];
        setPlaylists(next);
        if (next.length === 0) setError("没有找到匹配歌单");
      } else {
        const next = Array.isArray(data.tracks) ? data.tracks : [];
        setTracks(next);
        if (next.length === 0) setError("没有找到匹配歌曲");
      }
    } catch (reason) {
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
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-base font-semibold text-neutral-900">插入 QQ 音乐</h2>
          <button type="button" aria-label="关闭对话框" onClick={() => onClose(null)} className="rounded-full p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">×</button>
        </div>

        <div className="mt-4 flex gap-2 border-b border-neutral-200 pb-3">
          <button type="button" onClick={() => setTab("qq")} className={`rounded-md px-3 py-1.5 text-sm ${tab === "qq" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>搜索歌曲/歌单</button>
          <button type="button" onClick={() => setTab("manual")} className={`rounded-md px-3 py-1.5 text-sm ${tab === "manual" ? "bg-neutral-900 text-white" : "text-neutral-500 hover:bg-neutral-100"}`}>手动填写</button>
        </div>

        {tab === "manual" ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-xs leading-5 text-neutral-500">输入 QQ 音乐歌曲 MID 或歌单 ID。播放权限使用设置页中已登录的 QQ 音乐账号。</p>
            <label className="text-sm text-neutral-700">
              ID
              <input value={id} onChange={(event) => { setId(event.target.value); setError(""); }} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder="歌曲 MID 或歌单 ID" />
            </label>
            <label className="text-sm text-neutral-700">
              类型
              <select value={type} onChange={(event) => setType(event.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm">
                {MUSIC_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-700">
              <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} className="h-4 w-4 accent-neutral-700" />
              随机播放歌单
            </label>
            <p className="text-xs leading-5 text-neutral-400">文章中使用的格式为 <code>qqvip:id:song</code> 或 <code>qqvip:id:playlist</code>。</p>
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-xs leading-5 text-neutral-500">搜索 QQ 音乐歌曲或歌单，选择后会自动插入 QQ VIP 播放规格。</p>
            <div className="mt-3 inline-flex rounded-lg bg-neutral-100 p-1">
              <button type="button" onClick={() => changeSearchType("song")} className={`rounded-md px-3 py-1.5 text-xs ${searchType === "song" ? "bg-white font-medium text-neutral-900 shadow-sm" : "text-neutral-500"}`}>歌曲</button>
              <button type="button" onClick={() => changeSearchType("playlist")} className={`rounded-md px-3 py-1.5 text-xs ${searchType === "playlist" ? "bg-white font-medium text-neutral-900 shadow-sm" : "text-neutral-500"}`}>歌单</button>
            </div>
            <div className="mt-3 flex gap-2">
              <input value={keyword} onChange={(event) => { setKeyword(event.target.value); setError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchQQ(); } }} className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" placeholder={searchType === "playlist" ? "歌单名称" : "歌名或歌手"} />
              <button type="button" disabled={searching || !keyword.trim()} onClick={() => void searchQQ()} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white disabled:opacity-50">{searching ? "搜索中…" : "搜索"}</button>
            </div>
            {searchType === "playlist" && (
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-neutral-600">
                <input type="checkbox" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} className="h-4 w-4 accent-neutral-800" />
                插入后默认随机播放
              </label>
            )}
            <div className="mt-3 max-h-64 space-y-1 overflow-y-auto pr-1">
              {tracks.map((track) => (
                <button key={track.mid} type="button" onClick={() => onClose(createQQMusicSpec(track.mid, track))} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-neutral-100">
                  {track.cover ? <img src={track.cover} alt="" className="h-10 w-10 rounded-md bg-neutral-100 object-cover" /> : <span className="h-10 w-10 rounded-md bg-neutral-100" />}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-neutral-800">{track.name}</span><span className="mt-0.5 block truncate text-xs text-neutral-500">{[track.artist, track.album].filter(Boolean).join(" · ")}</span></span>
                  <span className="text-xs text-neutral-400">插入</span>
                </button>
              ))}
              {playlists.map((playlist) => (
                <button key={playlist.id} type="button" onClick={() => onClose(`qqvip:${playlist.id}:playlist${shuffle ? ":random" : ""}`)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-neutral-100">
                  {playlist.cover ? <img src={playlist.cover} alt="" className="h-10 w-10 rounded-md bg-neutral-100 object-cover" /> : <span className="h-10 w-10 rounded-md bg-neutral-100" />}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-neutral-800">{playlist.name}</span><span className="mt-0.5 block truncate text-xs text-neutral-500">{[playlist.creator, playlist.count === null ? "" : `${playlist.count} 首`].filter(Boolean).join(" · ")}</span></span>
                  <span className="text-xs text-neutral-400">插入</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        {tab === "manual" && (
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={() => onClose(null)} className="rounded-lg border border-neutral-300 px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-50">取消</button>
            <button type="button" onClick={confirm} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700">插入</button>
          </div>
        )}
      </div>
    </div>
  );
}
