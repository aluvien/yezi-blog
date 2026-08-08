import { NextResponse } from "next/server";
import { getClientIp, hashIp } from "@/lib/request";
import {
  findString,
  normalizeQQAudio,
  normalizeQQSearchTracks,
  qqMusicRequest,
  type QQSearchTrack,
  unwrapData,
} from "@/lib/qq-music-api";
import { getQQMusicSession } from "@/lib/qq-music-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 48;
const FALLBACK_CACHE_MS = 5 * 60_000;
const visitorHits = new Map<string, number[]>();
const fallbackCache = new Map<string, { expiresAt: number; track: FallbackTrack }>();

type FallbackTrack = {
  name: string;
  artist: string;
  cover: string;
  url: string;
  lrc: string;
};

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

function compact(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function candidateScore(candidate: QQSearchTrack, title: string, artist: string): number {
  const wantedTitle = compact(title);
  const candidateTitle = compact(candidate.name);
  const wantedArtist = compact(artist);
  const candidateArtist = compact(candidate.artist);
  let score = 0;
  if (!wantedTitle || !candidateTitle) return 0;
  if (wantedTitle === candidateTitle) score += 80;
  else if (candidateTitle.includes(wantedTitle) || wantedTitle.includes(candidateTitle)) score += 55;
  else return 0;
  if (wantedArtist && candidateArtist) {
    if (wantedArtist === candidateArtist) score += 45;
    else if (candidateArtist.includes(wantedArtist) || wantedArtist.includes(candidateArtist)) score += 28;
  }
  return score;
}

async function resolveCandidate(candidate: QQSearchTrack): Promise<FallbackTrack | null> {
  try {
    const raw = await qqMusicRequest("/getMusicPlay", {
      query: { songmid: candidate.mid, quality: "320" },
    });
    const url = normalizeQQAudio(findString(unwrapData(raw), ["url", "purl", "playUrl", "play_url"]));
    if (!url) return null;
    return {
      name: candidate.name,
      artist: candidate.artist,
      cover: candidate.cover,
      url,
      lrc: `/api/music/qq?mid=${encodeURIComponent(candidate.mid)}&type=lyric`,
    };
  } catch {
    // A search result may exist while the account has no playback permission;
    // try the next matching result before reporting that no replacement exists.
    return null;
  }
}

async function resolveFallback(title: string, artist: string): Promise<FallbackTrack | null> {
  const searchKey = `${title}\u0000${artist}`;
  const cached = fallbackCache.get(searchKey);
  if (cached && cached.expiresAt > Date.now()) return cached.track;

  const raw = await qqMusicRequest("/getSearchByKey", {
    query: { key: `${title} ${artist}`.trim().slice(0, 160), limit: "20" },
  });
  const candidates = normalizeQQSearchTracks(raw)
    .map((candidate) => ({ candidate, score: candidateScore(candidate, title, artist) }))
    .filter(({ score }) => score >= (artist ? 35 : 20))
    .sort((left, right) => right.score - left.score)
    .slice(0, 10)
    .map(({ candidate }) => candidate);

  for (const candidate of candidates) {
    const track = await resolveCandidate(candidate);
    if (!track) continue;
    fallbackCache.set(searchKey, { expiresAt: Date.now() + FALLBACK_CACHE_MS, track });
    return track;
  }
  return null;
}

export async function GET(request: Request) {
  if (!allowed(request)) return jsonError("请求过于频繁，请稍后再试", 429);
  const url = new URL(request.url);
  const title = (url.searchParams.get("title") ?? "").trim().slice(0, 180);
  const artist = (url.searchParams.get("artist") ?? "").trim().slice(0, 180);
  if (!title) return jsonError("缺少歌曲名称", 400);
  if (!getQQMusicSession()) return jsonError("QQ 音乐未登录，无法获取替代播放源", 409);

  try {
    const track = await resolveFallback(title, artist);
    return track
      ? NextResponse.json(track, { headers: { "cache-control": "private, max-age=300" } })
      : jsonError("QQ 音乐没有找到可播放的对应歌曲", 404);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "QQ 音乐替代服务暂不可用", 502);
  }
}
