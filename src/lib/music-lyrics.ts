import { parseLrc, type LyricLine } from "@/lib/lyrics";

type LyricTrack = { key?: string; url: string; name: string; artist?: string; lrc?: string };

const lyricPromises = new Map<string, Promise<LyricLine[]>>();

function trackKey(track: LyricTrack): string {
  return track.key?.trim() || track.url.trim() || `${track.name}\u0000${track.artist ?? ""}`;
}

function isInlineLrc(source: string): boolean {
  return /^\s*\[\d{1,3}:[0-5]\d(?:[.:]\d{1,3})?]/.test(source);
}

/**
 * 全站共享歌词请求和解析结果。
 * 文章卡片与全局 APlayer 都从这里取歌词，避免同一首歌各自请求、时序不一致。
 */
export function getMusicLyrics(track: LyricTrack, sourceOverride?: string): Promise<LyricLine[]> {
  const source = sourceOverride?.trim() || track.lrc?.trim() || "";
  if (!source) return Promise.resolve([]);
  const key = `${trackKey(track)}\u0000${source}`;
  const cached = lyricPromises.get(key);
  if (cached) return cached;

  const request = (isInlineLrc(source)
    ? Promise.resolve(source)
    : fetch(source, { cache: "no-store", signal: AbortSignal.timeout(12_000) })
      .then((response) => response.ok ? response.text() : "")
  )
    .then((text) => text ? parseLrc(text) : [])
    .catch(() => []);
  lyricPromises.set(key, request);
  return request;
}
