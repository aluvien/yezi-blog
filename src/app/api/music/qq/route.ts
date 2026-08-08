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

function trackInfo(raw: unknown, mid: string) {
  const data = unwrapData(raw);
  const song = findRecord(data, ["track_info", "trackInfo", "songinfo", "song", "info"]) ?? asRecord(data) ?? {};
  const album = asRecord(song.album);
  const albumMid = album ? getRecordString(album, ["mid", "albummid", "albumMid"]) : "";
  return {
    name: getRecordString(song, ["name", "songname", "title"]) || "QQ 音乐",
    artist: singerNames(song.singer ?? song.singers) || getRecordString(song, ["singername", "artist", "author"]),
    cover: normalizeQQCover(getRecordString(song, ["cover", "pic", "image"]) || (album ? getRecordString(album, ["pic", "cover", "image"]) : ""))
      || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : ""),
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
      qqMusicRequest("/getSongInfo", { query: { songmid: mid } }),
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
