import { getQQMusicSession } from "@/lib/qq-music-session";

/**
 * QQ Music sidecar adapter.
 *
 * The QQ Music API runs on the same server and owns the QQ login cookie.  This
 * module deliberately never returns that cookie to callers: route handlers
 * only expose the minimal data the admin UI or player needs.
 */

export const QQ_MUSIC_API_URL = (process.env.QQ_MUSIC_API_URL || "http://127.0.0.1:3200").replace(/\/+$/, "");

export type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getString(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
}

/** Resolve a local API path without allowing a caller-controlled target URL. */
function apiUrl(pathname: string, query?: Record<string, string | undefined>): URL {
  const root = new URL(QQ_MUSIC_API_URL);
  if (root.protocol !== "http:" && root.protocol !== "https:") throw new Error("QQ 音乐服务地址无效");
  const url = new URL(pathname, root);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value) url.searchParams.set(key, value);
  }
  return url;
}

export async function qqMusicRequest(pathname: string, options: {
  query?: Record<string, string | undefined>;
  method?: "GET" | "POST";
  body?: unknown;
  /** QR login itself does not need the existing account session. */
  useSession?: boolean;
} = {}): Promise<unknown> {
  const session = options.useSession === false ? null : getQQMusicSession();
  const response = await fetch(apiUrl(pathname, options.query), {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(session ? { "X-Custom-Cookie": session.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error("QQ 音乐服务返回了无效数据");
  }
  if (!response.ok) {
    const message = findString(data, ["message", "msg", "error"]) || `QQ 音乐服务错误（${response.status}）`;
    throw new Error(message);
  }
  return data;
}

/** Standard API responses commonly wrap their useful content under `data`. */
export function unwrapData(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

/** Find a scalar by field name in a small, trusted response tree. */
export function findString(value: unknown, keys: string[], depth = 0): string {
  if (depth > 5 || !value) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findString(item, keys, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (!isRecord(value)) return "";
  for (const key of keys) {
    const found = getString(value[key]);
    if (found) return found;
  }
  for (const child of Object.values(value)) {
    const found = findString(child, keys, depth + 1);
    if (found) return found;
  }
  return "";
}

export function findRecord(value: unknown, keys: string[], depth = 0): JsonRecord | null {
  if (depth > 5 || !value) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findRecord(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const key of keys) {
    if (isRecord(value[key])) return value[key];
  }
  for (const child of Object.values(value)) {
    const found = findRecord(child, keys, depth + 1);
    if (found) return found;
  }
  return null;
}

export function findArray(value: unknown, keys: string[], depth = 0): unknown[] {
  if (depth > 5 || !value) return [];
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key] as unknown[];
  }
  for (const child of Object.values(value)) {
    const found = findArray(child, keys, depth + 1);
    if (found.length) return found;
  }
  return [];
}

export function readCookie(value: unknown): string {
  return findString(value, ["cookie"]);
}

export function readUin(value: unknown): string {
  const direct = findString(value, ["loginUin", "uin", "qq"]);
  const cookie = readCookie(value);
  const fromCookie = cookie.match(/(?:^|;\s*)(?:uin|qqmusic_uin)=o?(\d+)/i)?.[1] ?? "";
  return (direct || fromCookie).replace(/^o/, "").replace(/\D/g, "").slice(0, 16);
}

export function normalizeQQCover(value: unknown): string {
  const cover = getString(value);
  if (cover.startsWith("//")) return `https:${cover}`;
  if (cover.startsWith("http://")) return `https://${cover.slice("http://".length)}`;
  return cover;
}

/** Avoid mixed-content playback when QQ's API happens to return an http URL. */
export function normalizeQQAudio(value: unknown): string {
  const url = getString(value);
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http://")) return `https://${url.slice("http://".length)}`;
  return url;
}

export function singerNames(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => isRecord(item) ? getString(item.name ?? item.title) : getString(item))
    .filter(Boolean)
    .join(" / ");
}

export function getRecordString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const result = getString(record[key]);
    if (result) return result;
  }
  return "";
}

export type QQSearchTrack = {
  mid: string;
  name: string;
  artist: string;
  album: string;
  cover: string;
};

/**
 * Normalize the search response shared by the admin picker and public QQ
 * fallback route. The sidecar has used both `data.song.list` and a flatter
 * `data.list` envelope across releases.
 */
export function normalizeQQSearchTracks(raw: unknown): QQSearchTrack[] {
  const data = unwrapData(raw);
  const songRoot = findRecord(data, ["song", "songs"]);
  const list = findArray(songRoot ?? data, ["list", "songList", "songs"]);
  return list.flatMap((item) => {
    const song = isRecord(item) ? item : null;
    if (!song) return [];
    const mid = getRecordString(song, ["songmid", "mid", "songMid"]);
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(mid)) return [];
    const album = isRecord(song.album) ? song.album : null;
    const albumMid = album ? getRecordString(album, ["mid", "albummid", "albumMid"]) : "";
    const cover = normalizeQQCover(
      getRecordString(song, ["cover", "pic", "image", "picurl", "picUrl"])
        || (album ? getRecordString(album, ["pic", "cover", "image", "picurl", "picUrl"]) : ""),
    ) || (albumMid ? `https://y.gtimg.cn/music/photo_new/T002R300x300M000${albumMid}.jpg` : "");
    return [{
      mid,
      name: getRecordString(song, ["songname", "name", "title"]) || "未知歌曲",
      artist: singerNames(song.singer ?? song.singers ?? song.singerInfo)
        || getRecordString(song, ["singername", "singerName", "artist", "author"]),
      album: album
        ? getRecordString(album, ["name", "title", "albumName"])
        : getRecordString(song, ["albumname", "albumName"]),
      cover,
    }];
  }).slice(0, 30);
}
