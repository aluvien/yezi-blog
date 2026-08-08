import { NextResponse } from "next/server";
import { getClientIp, hashIp } from "@/lib/request";
import {
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
    || getRecordString(song, ["albummid", "albumMid"]);
  const cover = normalizeQQCover(
    getRecordString(song, ["cover", "pic", "image", "picurl", "picUrl"])
      || (album ? getRecordString(album, ["pic", "cover", "image", "picurl", "picUrl"]) : ""),
  ) || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : "");
  return {
    name: getRecordString(song, ["name", "songname", "songName", "title"]) || "QQ 音乐",
    artist: singerNames(song.singer ?? song.singers ?? song.singerInfo)
      || getRecordString(song, ["singername", "singerName", "artist", "author"]),
    cover,
    key: `qqvip:${mid}`,
  };
}

function playbackUrl(raw: unknown): string {
  const data = unwrapData(raw);
  return normalizeQQAudio(findString(data, ["url", "purl", "playUrl", "play_url"]));
}

export async function GET(request: Request) {
  if (!allowed(request)) return jsonError("请求过于频繁，请稍后再试", 429);
  const url = new URL(request.url);
  const mid = (url.searchParams.get("mid") ?? "").trim();
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(mid)) return jsonError("歌曲标识无效", 400);
  const kind = url.searchParams.get("type") ?? "track";
  try {
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
    return NextResponse.json({ ...trackInfo(infoRaw, mid), url: audio, lrc: `/api/music/qq?mid=${encodeURIComponent(mid)}&type=lyric` }, {
      headers: { "cache-control": "private, max-age=120" },
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "QQ 音乐服务暂不可用", 502);
  }
}
