import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getClientIp, hashIp } from "@/lib/request";
import { createSlidingWindowLimiter } from "@/lib/rate-limit";
import { isPublicQQMusicSpec, lyricUrl, verifyLyricAuthorization } from "@/lib/qq-music-access";
import { normalizeMusicDisplayText } from "@/lib/music";
import { BoundedSingleFlight } from "@/lib/bounded-single-flight";
import {
  findRecord,
  findString,
  getRecordString,
  normalizeQQAudio,
  normalizeQQCover,
  normalizeQQSearchTracks,
  qqMusicRequest,
  singerNames,
  type JsonRecord,
  unwrapData,
} from "@/lib/qq-music-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 12;
const allowQQMusicRequest = createSlidingWindowLimiter({ windowMs: WINDOW_MS, maxRequests: MAX_REQUESTS, maxKeys: 5_000 });
const RESOLUTION_TIMEOUT_MS = 25_000;
const FAILURE_CACHE_MS = 15_000;
const MAX_CONCURRENT_RESOLUTIONS = 4;
const expensiveResolution = new BoundedSingleFlight({
  timeoutMs: RESOLUTION_TIMEOUT_MS,
  failureCacheMs: FAILURE_CACHE_MS,
  maxConcurrent: MAX_CONCURRENT_RESOLUTIONS,
});

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function safeHttpsUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

/** Locate the actual song object across both batch and legacy response envelopes. */
function songRecord(value: unknown, depth = 0): JsonRecord | null {
  if (depth > 6 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = songRecord(item, depth + 1);
      if (result) return result;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  if (getRecordString(record, ["mid", "songmid", "songMid", "name", "songname", "songName", "title"])) return record;

  // Prefer structural fields first: a song has an album/singer child, so a
  // depth-first scan of all values could otherwise select that child instead.
  for (const key of ["track_info", "trackInfo", "songinfo", "songInfo", "song", "info", "songs", "songList", "list"]) {
    const result = songRecord(record[key], depth + 1);
    if (result) return result;
  }
  for (const child of Object.values(record)) {
    const result = songRecord(child, depth + 1);
    if (result) return result;
  }
  return null;
}

function trackInfo(raw: unknown, mid: string) {
  const data = unwrapData(raw);
  // batchGetSongInfo returns an array on newer qq-music-api releases, while
  // older builds wrap the actual song below songInfo / track_info. Keep this
  // intentionally permissive so the visible card does not lose its metadata
  // merely because the sidecar changed its response envelope.
  const song = songRecord(data)
    ?? findRecord(data, ["track_info", "trackInfo", "songinfo", "songInfo", "song", "info"])
    ?? asRecord(data)
    ?? {};
  const album = asRecord(song.album);
  const albumMid = (album ? getRecordString(album, ["mid", "albummid", "albumMid"]) : "")
    || getRecordString(song, ["albummid", "albumMid"])
    || findString(data, ["albummid", "albumMid"]);
  const cover = safeHttpsUrl(normalizeQQCover(
    getRecordString(song, ["cover", "pic", "image", "picurl", "picUrl"])
      || (album ? getRecordString(album, ["pic", "cover", "image", "picurl", "picUrl"]) : "")
      || findString(data, ["cover", "pic", "image", "picurl", "picUrl"]),
  ) || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : ""));
  return {
    name: normalizeMusicDisplayText(getRecordString(song, ["name", "songname", "songName", "title"])
      || findString(data, ["songname", "songName", "name", "title"])
      || "QQ 音乐", "QQ 音乐"),
    artist: normalizeMusicDisplayText(singerNames(song.singer ?? song.singers ?? song.singerInfo)
      || getRecordString(song, ["singername", "singerName", "artist", "author"])
      || findString(data, ["singername", "singerName", "artist", "author"])),
    cover,
    key: `qqvip:${mid}`,
  };
}

/**
 * qq-music-api 的 batchGetSongInfo 在部分部署中会成功返回但不携带详情。
 * QQ 的公开单曲详情接口不需要登录 Cookie，作为“仅补展示信息”的后备；
 * 播放地址仍始终由已登录的本地 sidecar 获取。
 */
async function publicTrackInfo(mid: string, signal?: AbortSignal): Promise<ReturnType<typeof trackInfo> | null> {
  try {
    const endpoint = new URL("https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg");
    endpoint.searchParams.set("songmid", mid);
    endpoint.searchParams.set("format", "json");
    const response = await fetch(endpoint, {
      headers: { referer: "https://y.qq.com/" },
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const raw = await response.json() as unknown;
    const root = asRecord(raw);
    const first = root && Array.isArray(root.data) ? asRecord(root.data[0]) : null;
    return first ? trackInfo({ data: first }, mid) : null;
  } catch {
    return null;
  }
}

function playbackUrl(raw: unknown): string {
  const data = unwrapData(raw);
  return safeHttpsUrl(normalizeQQAudio(findString(data, ["url", "purl", "playUrl", "play_url"])));
}

function isPlaylistSong(value: JsonRecord): boolean {
  return Boolean(getRecordString(value, ["songmid", "mid", "songMid", "songid", "songId"]));
}

/**
 * 歌单详情在不同 qq-music-api 版本中的结构并不完全一致：
 * `data.songlist`、`data.cdlist[0].songlist` 以及更深一层的 `result` 都出现过。
 * 不能直接用 findArray，因为它可能先把 cdlist 当成歌曲列表返回，随后所有项目
 * 都没有 songmid，最终播放器就会得到空数组并显示 No audio。
 */
function findPlaylistSongs(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 8 || !value) return [];
  if (Array.isArray(value)) {
    const songs = value.flatMap((item) => {
      const record = asRecord(item);
      return record && isPlaylistSong(record) ? [record] : [];
    });
    if (songs.length > 0) return songs;
    for (const item of value) {
      const nested = findPlaylistSongs(item, depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }

  const record = asRecord(value);
  if (!record) return [];

  // 先查明确定义的歌曲字段，再查歌单/结果包裹字段，避免在同一响应里误选到
  // 歌单摘要对象或歌手、专辑子对象。
  for (const key of ["songlist", "songList", "songs", "tracks", "tracklist", "trackList"]) {
    const nested = findPlaylistSongs(record[key], depth + 1);
    if (nested.length > 0) return nested;
  }
  for (const key of ["cdlist", "cdList", "playlist", "data", "result", "response"]) {
    const nested = findPlaylistSongs(record[key], depth + 1);
    if (nested.length > 0) return nested;
  }
  for (const child of Object.values(record)) {
    const nested = findPlaylistSongs(child, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

function playlistSongs(raw: unknown): JsonRecord[] {
  return findPlaylistSongs(unwrapData(raw));
}

type ResolvedPlaylistTrack = ReturnType<typeof trackInfo> & { url: string; lrc: string };

async function resolvePlaylistTrack(song: JsonRecord, signal: AbortSignal): Promise<ResolvedPlaylistTrack | null> {
  const mid = getRecordString(song, ["songmid", "mid", "songMid", "songid", "songId"]);
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(mid)) return null;
  try {
    const raw = await qqMusicRequest("/getMusicPlay", { query: { songmid: mid, quality: "320" }, signal });
    const url = playbackUrl(raw);
    if (!url) return null;
    return {
      ...trackInfo({ data: song }, mid),
      url,
      lrc: lyricUrl(mid),
    };
  } catch {
    // 单首歌曲没有播放权限时跳过，不影响歌单中其他歌曲继续播放。
    return null;
  }
}

const playlistCache = new Map<string, { expiresAt: number; data: { tracks: ResolvedPlaylistTrack[]; total: number; skipped: number } }>();
const PLAYLIST_CACHE_MS = 90_000;
const MAX_PLAYLIST_TRACKS = 20;
const publicCoverCache = new Map<string, { expiresAt: number; cover: string }>();
const PUBLIC_COVER_CACHE_MS = 10 * 60_000;

/**
 * Some older QQ tracks return a blank album from the single-song detail API,
 * even though QQ's search result still has the exact track and album ID.
 * Use that public metadata only as a cover fallback for existing bare-MID
 * embeds; new embeds persist the same search snapshot in their music spec.
 */
async function publicSearchCover(mid: string, title: string): Promise<string> {
  const cached = publicCoverCache.get(mid);
  if (cached && cached.expiresAt > Date.now()) return cached.cover;
  if (!title.trim()) return "";

  let cover = "";
  try {
    const endpoint = new URL("https://c.y.qq.com/soso/fcgi-bin/client_search_cp");
    Object.entries({
      format: "json",
      outCharset: "utf-8",
      ct: "24",
      qqmusic_ver: "1298",
      remoteplace: "txt.yqq.song",
      t: "0",
      aggr: "1",
      cr: "1",
      p: "1",
      n: "30",
      w: title.slice(0, 180),
    }).forEach(([key, value]) => endpoint.searchParams.set(key, value));
    const response = await fetch(endpoint, {
      headers: { referer: "https://y.qq.com/", "user-agent": "Mozilla/5.0 (compatible; YeziBlog/1.0; +https://yezi.me)" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.ok) {
      cover = normalizeQQSearchTracks(await response.json() as unknown).find((track) => track.mid === mid)?.cover || "";
    }
  } catch {
    // The player remains usable when QQ's public metadata service is unavailable.
  }

  for (const [key, value] of publicCoverCache) {
    if (value.expiresAt <= Date.now()) publicCoverCache.delete(key);
  }
  while (publicCoverCache.size >= 200) publicCoverCache.delete(publicCoverCache.keys().next().value as string);
  publicCoverCache.set(mid, { expiresAt: Date.now() + PUBLIC_COVER_CACHE_MS, cover });
  return cover;
}

async function resolvePlaylist(disstid: string, signal: AbortSignal) {
  const cached = playlistCache.get(disstid);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const raw = await qqMusicRequest("/getSongListDetail", { query: { disstid }, signal });
  const songs = playlistSongs(raw);
  if (songs.length === 0) throw new Error("QQ 音乐歌单没有返回歌曲");
  const source = songs.slice(0, MAX_PLAYLIST_TRACKS);
  const tracks: ResolvedPlaylistTrack[] = [];
  // 限制并发，避免一个歌单同时触发大量播放地址请求。
  for (let index = 0; index < source.length; index += 4) {
    const batch = await Promise.all(source.slice(index, index + 4).map((song) => resolvePlaylistTrack(song, signal)));
    tracks.push(...batch.flatMap((track) => track ? [track] : []));
  }
  if (tracks.length === 0) throw new Error("歌单中的歌曲暂时都无法播放，请检查 QQ 音乐登录或会员状态");
  const data = { tracks, total: songs.length, skipped: songs.length - tracks.length };
  for (const [key, value] of playlistCache) {
    if (value.expiresAt <= Date.now()) playlistCache.delete(key);
  }
  while (playlistCache.size >= 100) playlistCache.delete(playlistCache.keys().next().value as string);
  playlistCache.set(disstid, { expiresAt: Date.now() + PLAYLIST_CACHE_MS, data });
  return data;
}

export async function GET(request: Request) {
  if (!allowQQMusicRequest(hashIp(getClientIp(request)))) return jsonError("请求过于频繁，请稍后再试", 429);
  const url = new URL(request.url);
  const kind = url.searchParams.get("type") ?? "track";
  const identifier = (url.searchParams.get("id") ?? url.searchParams.get("mid") ?? "").trim();
  if (!["track", "playlist", "lyric", "song"].includes(kind)) return jsonError("请求类型无效", 400);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(identifier)) return jsonError(kind === "playlist" ? "歌单标识无效" : "歌曲标识无效", 400);
  const admin = await requireAdminApi();
  const publicType = kind === "playlist" ? "playlist" : "song";
  if (kind === "lyric") {
    const token = url.searchParams.get("token") ?? "";
    if (!admin && !verifyLyricAuthorization(identifier, token)) return jsonError("歌词授权无效或已过期", 403);
  } else if (!admin && !isPublicQQMusicSpec(publicType, identifier)) {
    return jsonError("音乐未在公开内容中授权", 403);
  }
  try {
    if (kind === "playlist") {
      const data = await expensiveResolution.run(`playlist:${identifier}`, (signal) => resolvePlaylist(identifier, signal));
      return NextResponse.json(data, { headers: { "cache-control": "private, max-age=60" } });
    }
    const mid = identifier;
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(mid)) return jsonError("歌曲标识无效", 400);
    if (kind === "lyric") {
      const lyric = await expensiveResolution.run(`lyric:${mid}`, async (signal) => {
        const raw = await qqMusicRequest("/getLyric", { query: { songmid: mid, isFormat: "1" }, signal });
        return findString(unwrapData(raw), ["lyric", "lrc"]).slice(0, 512 * 1024);
      });
      return new Response(lyric, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, max-age=300" } });
    }
    const track = await expensiveResolution.run(`track:${mid}`, async (signal) => {
      const [infoRaw, playRaw] = await Promise.all([
        qqMusicRequest("/batchGetSongInfo", { method: "POST", body: { songs: [[mid]] }, signal }),
        qqMusicRequest("/getMusicPlay", { query: { songmid: mid, quality: "320" }, signal }),
      ]);
      const audio = playbackUrl(playRaw);
      if (!audio) throw new Error("播放地址不可用");
      const primaryInfo = trackInfo(infoRaw, mid);
      const fallbackInfo = (!primaryInfo.artist || !primaryInfo.cover || primaryInfo.name === "QQ 音乐")
        ? await publicTrackInfo(mid, signal)
        : null;
      const info = fallbackInfo
        ? {
            name: fallbackInfo.name === "QQ 音乐" ? primaryInfo.name : fallbackInfo.name,
            artist: fallbackInfo.artist || primaryInfo.artist,
            cover: fallbackInfo.cover || primaryInfo.cover,
            key: primaryInfo.key,
        }
        : primaryInfo;
      const cover = safeHttpsUrl(info.cover || await publicSearchCover(mid, info.name));
      return { ...info, cover, url: audio, lrc: lyricUrl(mid) };
    });
    return NextResponse.json(track, {
      headers: { "cache-control": "private, max-age=120" },
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    console.warn(`[qq-music] ${kind} resolution failed${timedOut ? " (timeout)" : ""}`);
    return jsonError(timedOut ? "QQ 音乐解析超时，请稍后再试" : "QQ 音乐服务暂不可用，请稍后再试", timedOut ? 504 : 502);
  }
}
