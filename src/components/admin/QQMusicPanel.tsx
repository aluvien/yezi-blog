"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ADMIN_CSRF_HEADER } from "@/lib/client-security";

type Status = {
  available: boolean;
  loggedIn: boolean;
  playable: boolean;
  healthStatus: "healthy" | "missing_session" | "expired" | "unavailable" | "unverified";
  label: string;
  detail: string;
  checkedAt: string;
  uin: string | null;
};
type LoginSource = { label: string; website: string };
type Qr = {
  channel: "qq";
  image: string;
  qrsig: string;
  ptqrtoken: string;
  expiresAt: number;
  source: LoginSource;
} | {
  channel: "qqmusic";
  image: string;
  key: string;
  expiresAt: number;
  source: LoginSource;
};
type Playlist = {
  id: string;
  name: string;
  creator: string;
  count: number | null;
  cover: string;
  kind: "created" | "collected" | "search";
};

type Props = {
  defaultMusic: string;
  onDefaultMusicChange: (value: string) => void;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { ...ADMIN_CSRF_HEADER, ...Object.fromEntries(new Headers(init?.headers).entries()) },
    cache: "no-store",
  });
  const data = await response.json() as T & { error?: unknown };
  if (!response.ok || typeof data.error === "string") throw new Error(typeof data.error === "string" ? data.error : "请求失败");
  return data;
}

/** QQ login is deliberately kept in site settings: it controls a server-only cookie. */
export default function QQMusicPanel({ defaultMusic, onDefaultMusicChange }: Props) {
  const [status, setStatus] = useState<Status | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [playlistMessage, setPlaylistMessage] = useState("");
  const [playlistSearchKeyword, setPlaylistSearchKeyword] = useState("");
  const [playlistSearchResults, setPlaylistSearchResults] = useState<Playlist[]>([]);
  const [playlistSearchBusy, setPlaylistSearchBusy] = useState(false);
  const [playlistSearchMessage, setPlaylistSearchMessage] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [cacheMessage, setCacheMessage] = useState("");
  const pollingRef = useRef(false);

  const refreshStatus = useCallback(async (announce = false) => {
    setStatusBusy(true);
    try {
      const next = await api<Status>("/api/admin/qq-music?op=status");
      setStatus(next);
      if (announce) setMessage(`QQ 音乐状态：${next.label} · ${next.detail}`);
    } catch (error) {
      setStatus(null);
      setMessage(error instanceof Error ? error.message : "无法连接 QQ 音乐服务");
    } finally {
      setStatusBusy(false);
    }
  }, []);

  const loadPlaylists = useCallback(async () => {
    setPlaylistBusy(true);
    setPlaylistMessage("");
    try {
      const result = await api<{
        playlists?: Playlist[];
        counts?: { created?: number; collected?: number };
        warning?: string;
      }>("/api/admin/qq-music?op=playlists");
      const next = Array.isArray(result.playlists) ? result.playlists : [];
      setPlaylists(next);
      const created = result.counts?.created ?? next.filter((playlist) => playlist.kind === "created").length;
      const collected = result.counts?.collected ?? next.filter((playlist) => playlist.kind === "collected").length;
      const summary = next.length
        ? `已读取 ${next.length} 个歌单（自建 ${created} · 收藏 ${collected}）`
        : "没有读取到可用歌单";
      setPlaylistMessage(result.warning ? `${summary}；${result.warning}` : summary);
    } catch (error) {
      setPlaylists([]);
      setPlaylistMessage(error instanceof Error ? error.message : "读取歌单失败");
    } finally {
      setPlaylistBusy(false);
    }
  }, []);

  async function searchPlaylists() {
    const query = playlistSearchKeyword.trim();
    if (!query) return;
    setPlaylistSearchBusy(true);
    setPlaylistSearchMessage("");
    try {
      const result = await api<{ playlists?: Playlist[] }>(`/api/admin/qq-music?op=search&type=playlist&q=${encodeURIComponent(query)}`);
      const next = Array.isArray(result.playlists) ? result.playlists : [];
      setPlaylistSearchResults(next);
      setPlaylistSearchMessage(next.length ? `找到 ${next.length} 个歌单` : "没有找到匹配歌单");
    } catch (error) {
      setPlaylistSearchResults([]);
      setPlaylistSearchMessage(error instanceof Error ? error.message : "搜索歌单失败");
    } finally {
      setPlaylistSearchBusy(false);
    }
  }

  function choosePlaylist(playlist: Playlist) {
    onDefaultMusicChange(`qqvip:${playlist.id}:playlist`);
    setPlaylistSearchMessage(`已选择「${playlist.name}」`);
  }

  useEffect(() => {
    // Defer the first request one task so React does not synchronously cascade
    // a state update while mounting this settings form.
    const timer = window.setTimeout(() => { void refreshStatus(); }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshStatus]);

  useEffect(() => {
    if (!status?.loggedIn) return;
    const timer = window.setTimeout(() => { void loadPlaylists(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadPlaylists, status?.loggedIn]);

  useEffect(() => {
    if (!qr) return;
    let stopped = false;
    const poll = async () => {
      if (pollingRef.current || stopped) return;
      if (Date.now() >= qr.expiresAt) {
        setQr(null);
        setMessage(`二维码已过期，请重新生成后扫码。来源：${qr.source.label}（${qr.source.website}）`);
        return;
      }
      pollingRef.current = true;
      try {
        const result = await api<{ state?: string; uin?: string; message?: string }>("/api/admin/qq-music", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(qr.channel === "qq"
            ? { op: "poll", qrsig: qr.qrsig, ptqrtoken: qr.ptqrtoken }
            : { op: "native-poll", key: qr.key }),
        });
        if (result.state === "success") {
          setStatus({
            available: true,
            loggedIn: true,
            playable: false,
            healthStatus: "unverified",
            label: "正在验证",
            detail: "登录 Cookie 已保存，正在验证播放授权",
            checkedAt: new Date().toISOString(),
            uin: result.uin ?? null,
          });
          setMessage(`${qr.channel === "qqmusic" ? "QQ 音乐 App" : "QQ"} 扫码登录成功，会员权限已仅保存在服务器。`);
          setQr(null);
          void refreshStatus();
        } else if (result.state === "expired") {
          setMessage(result.message || `二维码已过期或登录失败。来源：${qr.source.label}（${qr.source.website}）`);
          setQr(null);
        } else if (result.message) {
          setMessage(result.message);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "登录状态检查失败");
      } finally {
        pollingRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => { void poll(); }, 2000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      if (qr.channel === "qqmusic") {
        void api("/api/admin/qq-music", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ op: "native-cancel", key: qr.key }),
        }).catch(() => undefined);
      }
    };
  }, [qr, refreshStatus]);

  async function openQr(channel: "qq" | "qqmusic") {
    setBusy(true);
    setMessage("");
    try {
      setQr(await api<Qr>(`/api/admin/qq-music?op=${channel === "qq" ? "qr" : "native-qr"}`));
      setMessage(channel === "qq"
        ? "请用手机 QQ 扫码，并在手机上确认登录。"
        : "请用 QQ 音乐 App 扫码，并在 App 中确认登录。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法生成二维码");
    } finally {
      setBusy(false);
    }
  }

  async function cleanupMetadataCache() {
    setCacheBusy(true);
    setCacheMessage("");
    try {
      const result = await api<{
        deleted: number;
        deletedPlaylists: number;
        referenced: number;
        referencedPlaylists: number;
      }>("/api/admin/qq-music", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ op: "cleanup-metadata-cache" }),
      });
      const removedPlaylists = Number(result.deletedPlaylists ?? 0);
      const retainedPlaylists = Number(result.referencedPlaylists ?? 0);
      setCacheMessage(result.deleted > 0 || removedPlaylists > 0
        ? `已清理 ${result.deleted} 条歌曲缓存和 ${removedPlaylists} 个歌单快照；保留 ${result.referenced} 首单曲及 ${retainedPlaylists} 个正在引用的歌单。`
        : `没有发现未引用缓存；当前保留 ${result.referenced} 首单曲及 ${retainedPlaylists} 个正在引用的歌单。`);
    } catch (error) {
      setCacheMessage(error instanceof Error ? error.message : "清理歌曲缓存失败");
    } finally {
      setCacheBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-800">QQ 音乐账号</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">
            扫码后的 Cookie 仅保存在服务器受保护的会话文件中，不会存入网站数据库或下发给访客。
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs ${status?.playable ? "bg-emerald-100 text-emerald-700" : status?.healthStatus === "missing_session" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
          {statusBusy && status === null ? "检查中…" : status ? `${status.label}${status.uin ? ` · ${status.uin}` : ""}` : "检测失败"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} onClick={() => void openQr("qq")} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          {busy ? "生成中…" : "使用手机 QQ 扫码"}
        </button>
        <button type="button" disabled={busy} onClick={() => void openQr("qqmusic")} className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100 disabled:opacity-50">
          使用 QQ 音乐 App 扫码
        </button>
        <button type="button" disabled={statusBusy} onClick={() => void refreshStatus(true)} className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50">
          {statusBusy ? "检测中…" : "刷新状态"}
        </button>
      </div>

      {status?.detail && <p className={`mt-2 text-xs leading-5 ${status.playable ? "text-emerald-700" : "text-red-700"}`}>诊断：{status.detail}</p>}

      {qr && (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-neutral-200 bg-white p-4 sm:flex-row sm:items-start">
          {/* QR data is returned only from the admin-protected route. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr.image} alt="QQ 音乐登录二维码" className="h-40 w-40 rounded-lg border border-neutral-100 object-contain" />
          <div className="text-center sm:text-left">
            <p className="text-sm font-medium text-neutral-800">请使用{qr.channel === "qqmusic" ? " QQ 音乐 App" : "手机 QQ"}扫码</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">二维码有效期有限。扫描并确认后，本页会自动保存登录 Cookie。</p>
            <p className="mt-1 text-xs leading-5 text-neutral-400">来源：{qr.source.label}（{qr.source.website}）</p>
            <button type="button" onClick={() => setQr(null)} className="mt-3 text-xs text-neutral-500 underline underline-offset-2 hover:text-neutral-800">取消本次扫码</button>
          </div>
        </div>
      )}

      <div className="mt-4 border-t border-neutral-200 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-neutral-800">我的 QQ 歌单</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">同时读取账号自建和收藏的歌单，选择后作为全站播放器的默认歌单。</p>
          </div>
          <button
            type="button"
            disabled={!status?.loggedIn || playlistBusy}
            onClick={() => void loadPlaylists()}
            className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {playlistBusy ? "读取中…" : "刷新歌单"}
          </button>
        </div>
        <select
          value={defaultMusic.match(/^qqvip:([^:]+):playlist(?:$|:)/)?.[1] ?? ""}
          disabled={!status?.loggedIn || playlistBusy || playlists.length === 0}
          onChange={(event) => onDefaultMusicChange(event.target.value ? `qqvip:${event.target.value}:playlist` : "")}
          className="mt-3 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-100"
        >
          <option value="">不使用 QQ 默认歌单</option>
          {(["created", "collected"] as const).map((kind) => {
            const group = playlists.filter((playlist) => playlist.kind === kind);
            if (group.length === 0) return null;
            return (
              <optgroup key={kind} label={kind === "created" ? "自建歌单" : "收藏歌单"}>
                {group.map((playlist) => (
                  <option key={playlist.id} value={playlist.id}>
                    {playlist.name}{playlist.count === null ? "" : `（${playlist.count} 首）`}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
        <p className="mt-1.5 text-xs text-neutral-400">
          {!status?.loggedIn ? "请先扫码登录 QQ 音乐。" : playlistMessage || "选择歌单后，点击页面底部“保存设置”生效。"}
        </p>

        <div className="mt-4 border-t border-neutral-200 pt-4">
          <p className="text-sm font-medium text-neutral-800">搜索歌单</p>
          <p className="mt-1 text-xs leading-5 text-neutral-500">可搜索 QQ 音乐公开歌单；选择后会自动填入默认列表，播放时仍使用已登录账号权限。</p>
          <div className="mt-3 flex gap-2">
            <input
              value={playlistSearchKeyword}
              onChange={(event) => { setPlaylistSearchKeyword(event.target.value); setPlaylistSearchMessage(""); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void searchPlaylists(); } }}
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm"
              placeholder="输入歌单名称"
            />
            <button type="button" disabled={playlistSearchBusy || !playlistSearchKeyword.trim()} onClick={() => void searchPlaylists()} className="rounded-lg border border-neutral-300 bg-white px-3.5 py-2 text-sm text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50">
              {playlistSearchBusy ? "搜索中…" : "搜索"}
            </button>
          </div>
          {playlistSearchResults.length > 0 && (
            <div className="mt-3 max-h-56 space-y-1 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1">
              {playlistSearchResults.map((playlist) => (
                <button key={playlist.id} type="button" onClick={() => choosePlaylist(playlist)} className="flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-neutral-100">
                  {playlist.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={playlist.cover} alt="" className="h-9 w-9 rounded-md object-cover" />
                  ) : <span className="h-9 w-9 rounded-md bg-neutral-100" />}
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm text-neutral-800">{playlist.name}</span><span className="mt-0.5 block truncate text-xs text-neutral-500">{[playlist.creator, playlist.count === null ? "" : `${playlist.count} 首`].filter(Boolean).join(" · ")}</span></span>
                  <span className="shrink-0 text-xs text-accent">设为默认</span>
                </button>
              ))}
            </div>
          )}
          {playlistSearchMessage && <p className="mt-1.5 text-xs text-neutral-400">{playlistSearchMessage}</p>}
        </div>
      </div>
      <div className="mt-4 border-t border-neutral-200 pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-neutral-800">歌曲与歌单信息缓存</p>
            <p className="mt-1 text-xs leading-5 text-neutral-500">仅删除未被文章（含草稿）、絮语、关于页或默认音乐引用的本地歌名、歌手、封面及歌单顺序快照；不影响 QQ 登录或正文内容。</p>
          </div>
          <button type="button" disabled={cacheBusy} onClick={() => void cleanupMetadataCache()} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-600 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50">
            {cacheBusy ? "清理中…" : "清理未引用缓存"}
          </button>
        </div>
        {cacheMessage && <p className="mt-2 text-xs leading-5 text-neutral-500">{cacheMessage}</p>}
      </div>
      {message && <p className={`mt-3 text-xs leading-5 ${status?.available === false ? "text-red-600" : "text-neutral-500"}`}>{message}</p>}
    </div>
  );
}
