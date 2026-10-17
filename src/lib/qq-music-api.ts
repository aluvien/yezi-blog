import { randomBytes } from "node:crypto";
import { getQQMusicSession } from "@/lib/qq-music-session";
import { nativeQQMusicPlay } from "@/lib/qq-music-native-login";
import { searchQQMusicWithSession } from "@/lib/qq-music-credential";

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
  signal?: AbortSignal;
} = {}): Promise<unknown> {
  const session = options.useSession === false ? null : getQQMusicSession();
  if (pathname === "/getMusicPlay" && session?.nativeAuth && options.query?.songmid) {
    return { data: await nativeQQMusicPlay(session.nativeAuth, options.query.songmid, options.query.quality, options.signal) };
  }
  const response = await fetch(apiUrl(pathname, options.query), {
    method: options.method ?? "GET",
    headers: {
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
      ...(session ? { "X-Custom-Cookie": session.cookie } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: "no-store",
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(12_000)])
      : AbortSignal.timeout(12_000),
  });
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(response.ok ? "QQ 音乐服务返回了无效数据" : `QQ 音乐服务错误（${response.status}）`);
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

/** Prefer authenticated search when available; public metadata still has anonymous fallbacks. */
export async function searchQQTracks(keyword: string, limit = 30): Promise<QQSearchTrack[]> {
  const query = keyword.trim().slice(0, 80);
  if (!query) return [];
  const size = Number.isFinite(limit) ? Math.max(1, Math.min(Math.trunc(limit), 30)) : 30;

  const session = getQQMusicSession();
  if (session?.nativeAuth) {
    try {
      const list = await searchQQMusicWithSession(session, query, "song", size);
      return normalizeQQSearchTracks({ song: { list } }).slice(0, size);
    } catch {
      // A rejected search is not evidence that playback or the login has expired.
    }
  }

  try {
    const response = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST",
      headers: { "content-type": "application/json", referer: "https://y.qq.com/", "user-agent": "Mozilla/5.0" },
      body: JSON.stringify({
        // The desktop method with web ct=24 can silently return an empty list.
        // Verified on the deployed host: desktop ct=19 / cv=2201 returns songs.
        comm: { ct: 19, cv: 2201 },
        req_0: {
          module: "music.search.SearchCgiService",
          method: "DoSearchForQQMusicDesktop",
          param: {
            query, num_per_page: size, page_num: 1, search_type: 0, grp: true, highlight: false,
            searchid: randomBytes(8).readBigUInt64BE().toString(),
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("搜索请求失败");
    const raw: unknown = await response.json();
    const item = isRecord(raw) && isRecord(raw.req_0) ? raw.req_0 : null;
    const data = item && isRecord(item.data) ? item.data : null;
    const body = data && isRecord(data.body) ? data.body : null;
    const song = body && isRecord(body.song) ? body.song : null;
    if (!isRecord(raw) || raw.code !== 0 || item?.code !== 0
      || !data || (data.code !== undefined && data.code !== 0) || !song || !Array.isArray(song.list)) {
      throw new Error("搜索响应无效");
    }
    // A successful empty list is a real no-results response, not an outage.
    return normalizeQQSearchTracks({ song }).slice(0, size);
  } catch {
    // Keep compatibility with deployments whose existing sidecar search works.
  }

  try {
    const raw = await qqMusicRequest("/getSearchByKey", { query: { key: query, limit: String(size) }, useSession: false });
    const envelope = isRecord(raw) && isRecord(raw.response) ? raw.response : raw;
    const data = unwrapData(envelope);
    const song = findRecord(data, ["song", "songs"]);
    const list = song?.list ?? (isRecord(data) ? data.list : undefined);
    if ((isRecord(envelope) && envelope.code !== undefined && envelope.code !== 0)
      || (isRecord(data) && data.code !== undefined && data.code !== 0) || !Array.isArray(list)) {
      throw new Error("搜索响应无效");
    }
    return normalizeQQSearchTracks(envelope).slice(0, size);
  } catch {
    throw new Error("QQ 音乐歌曲搜索暂不可用，请稍后重试");
  }
}

export type QQPlaylistKind = "created" | "collected" | "search";

export type QQPlaylistSummary = {
  id: string;
  name: string;
  creator: string;
  count: number | null;
  cover: string;
  kind: QQPlaylistKind;
};

const PLAYLIST_CONTAINER_KEYS = [
  "playlists", "playlist", "songLists", "songlists", "songList", "songlist",
  "list", "cdlist", "cdList", "v_playlist", "vPlaylist", "disslist", "dissList",
  "mydiss", "mymusic", "body", "response", "data",
];

function playlistIdentifier(record: JsonRecord): string {
  const specific = getRecordString(record, [
    "disstid", "dissid", "dissId", "playlistId", "playlist_id", "tid", "dirid", "dirId",
  ]);
  if (specific) return specific;
  const generic = getRecordString(record, ["id"]);
  const hasPlaylistShape = [
    "dissname", "dissName", "playlistName", "songcount", "songCount", "song_count",
    "songnum", "songNum", "song_cnt", "cover_url_big", "coverurl",
  ].some((key) => record[key] !== undefined);
  return hasPlaylistShape ? generic : "";
}

function findPlaylistRecords(value: unknown, depth = 0): JsonRecord[] {
  if (depth > 9 || !value) return [];
  if (Array.isArray(value)) {
    const direct = value.flatMap((item) => isRecord(item) && playlistIdentifier(item) ? [item] : []);
    if (direct.length > 0) return direct;
    for (const item of value) {
      const nested = findPlaylistRecords(item, depth + 1);
      if (nested.length > 0) return nested;
    }
    return [];
  }
  if (!isRecord(value)) return [];
  for (const key of PLAYLIST_CONTAINER_KEYS) {
    const nested = findPlaylistRecords(value[key], depth + 1);
    if (nested.length > 0) return nested;
  }
  for (const child of Object.values(value)) {
    const nested = findPlaylistRecords(child, depth + 1);
    if (nested.length > 0) return nested;
  }
  return [];
}

function playlistCount(record: JsonRecord): number | null {
  for (const key of ["songcount", "songCount", "song_count", "songnum", "songNum", "song_cnt", "count", "total"]) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  }
  return null;
}

function playlistCreator(record: JsonRecord): string {
  const direct = getRecordString(record, ["creatorName", "creator_name", "nickname", "nick", "author"]);
  if (direct) return direct;
  const creator = isRecord(record.creator) ? record.creator : isRecord(record.user) ? record.user : null;
  return creator ? getRecordString(creator, ["name", "nickname", "nick", "title", "uin"]) : "";
}

/** Normalize created, collected and searched playlist envelopes used by QQ's old and new APIs. */
export function normalizeQQPlaylists(raw: unknown, kind: QQPlaylistKind, limit = 100): QQPlaylistSummary[] {
  const seen = new Set<string>();
  return findPlaylistRecords(raw).flatMap((playlist) => {
    const id = playlistIdentifier(playlist);
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    return [{
      id,
      name: getRecordString(playlist, ["dissname", "dissName", "name", "title", "playlistName", "dirName"]) || "未命名歌单",
      creator: playlistCreator(playlist),
      count: playlistCount(playlist),
      cover: normalizeQQCover(getRecordString(playlist, [
        "logo", "cover", "pic", "image", "picurl", "picUrl", "coverurl", "coverUrl",
        "cover_url", "cover_url_big", "pic_url",
      ])),
      kind,
    }];
  }).slice(0, Math.max(1, Math.min(limit, 100)));
}

/**
 * The sidecar's getSearchByKey controller intentionally fixes `t=0` (songs).
 * Playlist search therefore uses QQ's SearchCgiService directly on the server;
 * the owner's cookie is forwarded only upstream and never reaches the browser.
 */
export async function searchQQPlaylists(keyword: string, limit = 30): Promise<QQPlaylistSummary[]> {
  const query = keyword.trim().slice(0, 80);
  if (!query) return [];
  const size = Math.max(1, Math.min(limit, 30));
  const session = getQQMusicSession();
  if (session?.nativeAuth) {
    try {
      return normalizeQQPlaylists(await searchQQMusicWithSession(session, query, "playlist", size), "search", size);
    } catch {
      // Retain compatibility with existing anonymous search services.
    }
  }
  const headers = {
    "content-type": "application/json",
    referer: "https://y.qq.com/",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
    ...(session ? { cookie: session.cookie } : {}),
  };

  try {
    const response = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
      method: "POST",
      headers,
      body: JSON.stringify({
        comm: { ct: 24, cv: 0, format: "json", platform: "yqq.json", uin: session?.uin || "0" },
        playlistSearch: {
          method: "DoSearchForQQMusicDesktop",
          module: "music.search.SearchCgiService",
          param: {
            query,
            num_per_page: size,
            page_num: 1,
            search_type: 3,
            remoteplace: "txt.yqq.center",
            grp: 1,
          },
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    if (response.ok) {
      const playlists = normalizeQQPlaylists(await response.json() as unknown, "search", size);
      if (playlists.length > 0) return playlists;
    }
  } catch {
    // Continue with the legacy public search endpoint below.
  }

  try {
    const endpoint = new URL("https://c.y.qq.com/soso/fcgi-bin/client_search_cp");
    Object.entries({
      format: "json",
      outCharset: "utf-8",
      ct: "24",
      qqmusic_ver: "1298",
      remoteplace: "txt.yqq.playlist",
      t: "3",
      aggr: "1",
      cr: "1",
      p: "1",
      n: String(size),
      w: query,
    }).forEach(([key, value]) => endpoint.searchParams.set(key, value));
    const response = await fetch(endpoint, {
      headers: { referer: headers.referer, "user-agent": headers["user-agent"], ...(session ? { cookie: session.cookie } : {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    return response.ok ? normalizeQQPlaylists(await response.json() as unknown, "search", size) : [];
  } catch {
    return [];
  }
}

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
    // QQ's public search response currently puts `albummid` on the song
    // itself, while the sidecar has used nested `album.mid` in older versions.
    // Support both envelopes before constructing the stable QQ CDN cover URL.
    const albumMid = (album ? getRecordString(album, ["mid", "albummid", "albumMid", "album_mid"]) : "")
      || getRecordString(song, ["albummid", "albumMid", "album_mid"]);
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
