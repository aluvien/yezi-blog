import { NextResponse } from "next/server";
import { getClientIp, hashIp } from "@/lib/request";
import {
  findArray,
  findRecord,
  findString,
  getRecordString,
  normalizeQQAudio,
  normalizeQQCover,
  qqMusicRequest,
  singerNames,
  type JsonRecord,
  unwrapData,
} from "@/lib/qq-music-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 24;
const visitorHits = new Map<string, number[]>();

function allowed(request: Request): boolean {
  const key = hashIp(getClientIp(request));
  const cutoff = Date.now() - WINDOW_MS;
  const recent = (visitorHits.get(key) ?? []).filter((time) => time > cutoff);
  if (recent.length >= MAX_REQUESTS) {
    visitorHits.set(key, recent);
    return false;
  }
  recent.push(Date.now());
  visitorHits.set(key, recent);
  return true;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status, headers: { "cache-control": "no-store" } });
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
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
  const cover = normalizeQQCover(
    getRecordString(song, ["cover", "pic", "image", "picurl", "picUrl"])
      || (album ? getRecordString(album, ["pic", "cover", "image", "picurl", "picUrl"]) : "")
      || findString(data, ["cover", "pic", "image", "picurl", "picUrl"]),
  ) || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : "");
  return {
    name: getRecordString(song, ["name", "songname", "songName", "title"])
      || findString(data, ["songname", "songName", "name", "title"])
      || "QQ 音乐",
    artist: singerNames(song.singer ?? song.singers ?? song.singerInfo)
      || getRecordString(song, ["singername", "singerName", "artist", "author"])
      || findString(data, ["singername", "singerName", "artist", "author"]),
    cover,
    key: `qqvip:${mid}`,
  };
}

/**
 * qq-music-api 的 batchGetSongInfo 在部分部署中会成功返回但不携带详情。
 * QQ 的公开单曲详情接口不需要登录 Cookie，作为“仅补展示信息”的后备；
 * 播放地址仍始终由已登录的本地 sidecar 获取。
 */
async function publicTrackInfo(mid: string): Promise<ReturnType<typeof trackInfo> | null> {
  try {
    const endpoint = new URL("https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg");
    endpoint.searchParams.set("songmid", mid);
    endpoint.searchParams.set("format", "json");
    const response = await fetch(endpoint, {
      headers: { referer: "https://y.qq.com/" },
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
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
  return normalizeQQAudio(findString(data, ["url", "purl", "playUrl", "play_url"]));
}

function playlistSongs(raw: unknown): JsonRecord[] {
  const data = unwrapData(raw);
  const list = findArray(data, ["songlist", "songList", "songs", "list"]);
  return list.flatMap((item) => {
    const song = asRecord(item);
    return song ? [song] : [];
  });
}

type ResolvedPlaylistTrack = ReturnType<typeof trackInfo> & { url: string; lrc: string };

async function resolvePlaylistTrack(song: JsonRecord): Promise<ResolvedPlaylistTrack | null> {
  const mid = getRecordString(song, ["songmid", "mid", "songMid", "songid", "songId"]);
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(mid)) return null;
  try {
    const raw = await qqMusicRequest("/getMusicPlay", { query: { songmid: mid, quality: "320" } });
    const url = playbackUrl(raw);
    if (!url) return null;
    return {
      ...trackInfo({ data: song }, mid),
      url,
      lrc: `/api/music/qq?mid=${encodeURIComponent(mid)}&type=lyric`,
    };
  } catch {
    // 单首歌曲没有播放权限时跳过，不影响歌单中其他歌曲继续播放。
    return null;
  }
}

const playlistCache = new Map<string, { expiresAt: number; data: { tracks: ResolvedPlaylistTrack[]; total: number; skipped: number } }>();
const PLAYLIST_CACHE_MS = 90_000;
const MAX_PLAYLIST_TRACKS = 100;

async function resolvePlaylist(disstid: string) {
  const cached = playlistCache.get(disstid);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const raw = await qqMusicRequest("/getSongListDetail", { query: { disstid } });
  const songs = playlistSongs(raw);
  if (songs.length === 0) throw new Error("QQ 音乐歌单没有返回歌曲");
  const source = songs.slice(0, MAX_PLAYLIST_TRACKS);
  const tracks: ResolvedPlaylistTrack[] = [];
  // 限制并发，避免一个歌单同时触发大量播放地址请求。
  for (let index = 0; index < source.length; index += 4) {
    const batch = await Promise.all(source.slice(index, index + 4).map((song) => resolvePlaylistTrack(song)));
    tracks.push(...batch.flatMap((track) => track ? [track] : []));
  }
  if (tracks.length === 0) throw new Error("歌单中的歌曲暂时都无法播放，请检查 QQ 音乐登录或会员状态");
  const data = { tracks, total: songs.length, skipped: songs.length - tracks.length };
  playlistCache.set(disstid, { expiresAt: Date.now() + PLAYLIST_CACHE_MS, data });
  return data;
}

export async function GET(request: Request) {
  if (!allowed(request)) return jsonError("请求过于频繁，请稍后再试", 429);
  const url = new URL(request.url);
  const kind = url.searchParams.get("type") ?? "track";
  const identifier = (url.searchParams.get("id") ?? url.searchParams.get("mid") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(identifier)) return jsonError(kind === "playlist" ? "歌单标识无效" : "歌曲标识无效", 400);
  try {
    if (kind === "playlist") {
      const data = await resolvePlaylist(identifier);
      return NextResponse.json(data, { headers: { "cache-control": "private, max-age=60" } });
    }
    const mid = identifier;
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(mid)) return jsonError("歌曲标识无效", 400);
    if (kind === "lyric") {
      const raw = await qqMusicRequest("/getLyric", { query: { songmid: mid, isFormat: "1" } });
      const lyric = findString(unwrapData(raw), ["lyric", "lrc"]);
      return new Response(lyric, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, max-age=300" } });
    }
    const [infoRaw, playRaw] = await Promise.all([
      // getSongInfo is only a legacy alias in some sidecar versions. The
      // documented batch endpoint is available in v2.4 and returns full song,
      // singer and album metadata for the player card.
      qqMusicRequest("/batchGetSongInfo", { method: "POST", body: { songs: [[mid]] } }),
      qqMusicRequest("/getMusicPlay", { query: { songmid: mid, quality: "320" } }),
    ]);
    const audio = playbackUrl(playRaw);
    if (!audio) return jsonError("暂时无法获取这首歌的播放地址，请确认 QQ 音乐登录状态和会员权限", 422);
    const primaryInfo = trackInfo(infoRaw, mid);
    const fallbackInfo = (!primaryInfo.artist || !primaryInfo.cover || primaryInfo.name === "QQ 音乐")
      ? await publicTrackInfo(mid)
      : null;
    const info = fallbackInfo
      ? {
          name: fallbackInfo.name === "QQ 音乐" ? primaryInfo.name : fallbackInfo.name,
          artist: fallbackInfo.artist || primaryInfo.artist,
          cover: fallbackInfo.cover || primaryInfo.cover,
          key: primaryInfo.key,
        }
      : primaryInfo;
    return NextResponse.json({ ...info, url: audio, lrc: `/api/music/qq?mid=${encodeURIComponent(mid)}&type=lyric` }, {
      headers: { "cache-control": "private, max-age=120" },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "QQ 音乐服务暂不可用", 502);
  }
}
