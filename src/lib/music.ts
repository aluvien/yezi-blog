/**
 * 音乐内嵌：共享解析层。
 *
 * 文章用 Markdown 代码块：
 *   ```music
 *   netease:2280519151:playlist
 *   ```
 * 想法用正文独占行标记：`!music netease:1234567:song`
 *
 * 格式 `<server>:<id>[:<type>[:random]]`，type 缺省为 song；末尾加 random 可打乱歌单。
 * 前端 MusicInitializer
 * 读取渲染出的 `.blog-music` 容器上的 data-* 属性，调 Meting API 取音频并初始化 APlayer。
 */

export const DEFAULT_METING_API = "https://api.injahow.cn/meting/";

export const MUSIC_SERVERS = ["netease", "qq", "kugou", "kuwo", "xiami", "baidu", "qqvip"] as const;
export type MusicServer = (typeof MUSIC_SERVERS)[number];

export const MUSIC_TYPES = ["song", "playlist", "album", "search"] as const;
export type MusicType = (typeof MUSIC_TYPES)[number];

export interface MusicSpec {
  server: MusicServer;
  id: string;
  type: MusicType;
  shuffle?: boolean;
  /** QQ 登录搜索时随引用保存的展示快照，保证首屏无需再等详情接口。 */
  title?: string;
  artist?: string;
  cover?: string;
}

const SERVER_SET = new Set<string>(MUSIC_SERVERS);
const TYPE_SET = new Set<string>(MUSIC_TYPES);

function stringMetadata(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function qqMusicMetadata(mode: string | undefined): Pick<MusicSpec, "title" | "artist" | "cover"> | null {
  if (!mode?.startsWith("meta-")) return null;
  try {
    const raw = JSON.parse(decodeURIComponent(mode.slice("meta-".length))) as Record<string, unknown>;
    const title = stringMetadata(raw.title, 180);
    const artist = stringMetadata(raw.artist, 180);
    const candidateCover = stringMetadata(raw.cover, 1_500);
    const cover = /^https:\/\//i.test(candidateCover) ? candidateCover : "";
    return title || artist || cover ? { title, artist, cover } : null;
  } catch {
    return null;
  }
}

/** 供 QQ 搜索选择器生成带展示快照的引用规格。 */
export function createQQMusicSpec(mid: string, metadata: Pick<MusicSpec, "title" | "artist" | "cover">): string {
  const safeMid = mid.trim();
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(safeMid)) return "";
  const requestedCover = stringMetadata(metadata.cover, 1_500);
  const snapshot = {
    title: stringMetadata(metadata.title, 180),
    artist: stringMetadata(metadata.artist, 180),
    cover: /^https:\/\//i.test(requestedCover) ? requestedCover : "",
  };
  return `qqvip:${safeMid}:song:meta-${encodeURIComponent(JSON.stringify(snapshot))}`;
}

/** 解析 `server:id:type[:random]` 规格，无效返回 null。type 缺省为 song。 */
export function parseMusicSpec(input: string): MusicSpec | null {
  const raw = input.trim();
  if (!raw) return null;
  const parts = raw.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  const [server, id, type = "song", mode] = parts;
  if (!SERVER_SET.has(server)) return null;
  // QQ Music's official song MID is alphanumeric. `qqvip` means the playback
  // URL is resolved by our server-side adapter with the owner's login state.
  if (server === "qqvip" ? !/^[A-Za-z0-9_-]{4,80}$/.test(id) : !/^\d+$/.test(id)) return null;
  if (!TYPE_SET.has(type)) return null;
  const metadata = server === "qqvip" ? qqMusicMetadata(mode) : null;
  if (mode && mode !== "random" && mode !== "shuffle" && !metadata) return null;
  return {
    server: server as MusicServer,
    id,
    type: type as MusicType,
    shuffle: mode === "random" || mode === "shuffle",
    ...(metadata ?? {}),
  };
}

function queryParameter(url: URL, key: string): string {
  const direct = url.searchParams.get(key)?.trim();
  if (direct) return direct;
  const hashQuery = url.hash.match(/[?&]([^#]*)$/)?.[1];
  if (!hashQuery) return "";
  return new URLSearchParams(hashQuery).get(key)?.trim() || "";
}

/** 兼容旧文章中直接粘贴的网易云/QQ 音乐分享链接。 */
export function parseLegacyMusicUrl(input: string, preferredServer?: MusicServer): MusicSpec | null {
  const raw = input.trim();
  if (!/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const path = `${url.pathname}${url.hash}`.toLowerCase();
    if (host === "music.163.com" || host.endsWith(".music.163.com")) {
      const type = path.includes("playlist") ? "playlist" : path.includes("album") ? "album" : "song";
      const id = queryParameter(url, "id");
      return id && /^\d+$/.test(id) ? parseMusicSpec(`netease:${id}:${type}`) : null;
    }
    if (host === "y.qq.com" || host.endsWith(".qq.com")) {
      const type = path.includes("playlist") || path.includes("detail") && path.includes("playlist") ? "playlist" : "song";
      const id = queryParameter(url, type === "playlist" ? "disstid" : "songmid") || queryParameter(url, "id");
      if (!id) return null;
      const server = preferredServer === "qqvip" ? "qqvip" : "qq";
      return parseMusicSpec(`${server}:${id}:${type}`);
    }
  } catch {
    return null;
  }
  return null;
}

/** 兼容旧版 Meting.js 写法：<meting-js server="..." type="..." id="...">。 */
export function parseLegacyMetingHtml(input: string): MusicSpec | null {
  const match = input.trim().match(/^<meting-js\b([\s\S]*?)(?:\/>|>[\s\S]*?<\/meting-js>)$/i);
  if (!match) return null;
  const attributes: Record<string, string> = {};
  for (const attribute of match[1].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)) {
    attributes[attribute[1].toLowerCase()] = attribute[2].trim();
  }
  const server = (attributes.server || "netease").toLowerCase() as MusicServer;
  const auto = attributes.auto ? parseLegacyMusicUrl(attributes.auto, server) : null;
  if (auto) return auto;
  const id = attributes.id || attributes.songmid || attributes.disstid;
  const type = attributes.type || (attributes.disstid ? "playlist" : "song");
  return id ? parseMusicSpec(`${server}:${id}:${type}`) : null;
}

/** 文章 music 代码块内文本：每行一个规格，空行/无效行忽略。 */
export function parseMusicBlock(text: string, fallbackServer?: MusicServer): MusicSpec[] {
  const specs: MusicSpec[] = [];
  for (const line of text.split("\n")) {
    const value = line.trim();
    const spec = parseMusicSpec(value)
      || parseLegacyMusicUrl(value, fallbackServer)
      || (fallbackServer && /^\d+$/.test(value) ? parseMusicSpec(`${fallbackServer}:${value}:song`) : null);
    if (spec) specs.push(spec);
  }
  return specs;
}

export type MomentSegment =
  | { kind: "text"; value: string }
  | { kind: "music"; value: MusicSpec };

/**
 * 拆分想法正文：独占一行的 `!music server:id:type` 转为音乐段，
 * 其余连续行合并为文本段（保留换行）。无效的 !music 行按普通文本保留。
 */
export function splitMomentContent(content: string): MomentSegment[] {
  const lines = content.split("\n");
  const segments: MomentSegment[] = [];
  let textBuf: string[] = [];
  const flush = () => {
    if (textBuf.length > 0) {
      segments.push({ kind: "text", value: textBuf.join("\n") });
      textBuf = [];
    }
  };
  for (const line of lines) {
    const match = line.match(/^\s*!music\s+(.+?)\s*$/);
    if (match) {
      const spec = parseMusicSpec(match[1]);
      if (spec) {
        flush();
        segments.push({ kind: "music", value: spec });
        continue;
      }
    }
    textBuf.push(line);
  }
  flush();
  return segments;
}

/** 构造 Meting API 请求 URL。base 为 API 根地址（不含 query）。 */
export function buildMetingUrl(base: string, spec: MusicSpec): string {
  const root = (base || "").trim().replace(/[?&]+$/, "") || DEFAULT_METING_API;
  const params = new URLSearchParams({ server: spec.server, id: spec.id, type: spec.type });
  return `${root}?${params.toString()}`;
}

/** 服务端渲染：输出带 data-* 的播放器容器，供前端 MusicInitializer 初始化。 */
export function musicContainerHtml(spec: MusicSpec): string {
  const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
  const title = spec.title?.trim() ?? "";
  const artist = spec.artist?.trim() ?? "";
  const cover = spec.cover?.trim() ?? "";
  const snapshotAttributes = title || artist || cover
    ? ` data-music-name="${escapeAttribute(title)}" data-music-artist="${escapeAttribute(artist)}" data-music-cover="${escapeAttribute(cover)}"`
    : "";
  const fallback = spec.server === "qqvip" && title
    ? `<div class="music-trigger music-trigger-static"><span class="music-trigger-swipe-stage"><span class="music-trigger-swipe-slide" data-track-slot="current"><span class="music-trigger-cover${cover ? "" : " is-fallback"}">${cover ? `<img src="${escapeAttribute(cover)}" alt="">` : ""}</span><span class="music-trigger-info"><span class="music-trigger-name">${escapeAttribute(title)}</span><span class="music-trigger-artist"><span class="music-trigger-artist-name">${escapeAttribute(artist)}</span></span></span></span></span><span class="music-trigger-play" aria-hidden="true"></span></div>`
    : "";
  return `<div class="blog-music" data-server="${spec.server}" data-id="${spec.id}" data-type="${spec.type}" data-shuffle="${spec.shuffle ? "1" : "0"}${snapshotAttributes}>${fallback}</div>`;
}

/** 归一化后的可播放曲目（与 APlayer 的 APlayerAudio 字段一致）。 */
export interface MusicTrack {
  name: string;
  artist: string;
  url: string;
  cover: string;
  lrc: string;
  /** 跨页面/跨请求保持稳定，用于避免同一首歌重复加入全局列表。 */
  key?: string;
}

interface MetingTrack {
  name?: unknown;
  id?: unknown;
  songid?: unknown;
  mid?: unknown;
  url?: unknown;
  artist?: unknown;
  cover?: unknown;
  pic?: unknown;
  image?: unknown;
  lrc?: unknown;
  album?: { pic?: unknown; picUrl?: unknown };
}

function firstScalar(...values: unknown[]): string {
  const value = values.find((item) =>
    (typeof item === "string" && item.trim().length > 0) || typeof item === "number",
  );
  return value === undefined ? "" : String(value).trim();
}

/** 音乐接口常返回协议相对地址或 http 封面；站点使用 https 时统一转为可加载的地址。 */
function normalizeCoverUrl(value: string): string {
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("http://")) return `https://${value.slice("http://".length)}`;
  return value;
}

/**
 * 优先通过本站服务端代理请求 Meting，避免旧文章的网易云播放器受到浏览器
 * CORS、混合内容或外部接口网络策略影响；代理失败时保留原来的直连兜底。
 */
async function requestMetingTracks(metingApi: string, spec: MusicSpec): Promise<Response> {
  try {
    const proxy = await fetch(
      `/api/music/meting?server=${encodeURIComponent(spec.server)}&id=${encodeURIComponent(spec.id)}&type=${encodeURIComponent(spec.type)}`,
      { signal: AbortSignal.timeout(15_000), cache: "no-store" },
    );
    if (proxy.ok) return proxy;
  } catch {
    // 代理不可用时继续尝试原来的 Meting 地址。
  }
  return fetch(buildMetingUrl(metingApi, spec), { signal: AbortSignal.timeout(15_000), cache: "no-store" });
}

/**
 * 调 Meting API 拉取曲目并归一化为 MusicTrack[]。
 * 前端触发卡片与全局播放器的默认歌单都走这里，避免各自重复实现。
 */
export async function fetchMusicTracks(metingApi: string, spec: MusicSpec): Promise<MusicTrack[]> {
  if (spec.server === "qqvip") {
    if (spec.type !== "song" && spec.type !== "playlist") throw new Error("QQ 音乐登录播放暂支持单曲或歌单");
    const res = await fetch(`/api/music/qq?id=${encodeURIComponent(spec.id)}&type=${encodeURIComponent(spec.type)}`, { signal: AbortSignal.timeout(60_000), cache: "no-store" });
    if (!res.ok) {
      const payload = await res.json().catch(() => null) as { error?: unknown } | null;
      throw new Error(typeof payload?.error === "string" ? payload.error : `QQ 音乐 ${res.status}`);
    }
    const payload = await res.json() as Partial<MusicTrack> & { tracks?: unknown };
    if (spec.type === "playlist") {
      const tracks = Array.isArray(payload.tracks)
        ? payload.tracks.flatMap((value, index) => {
            if (!value || typeof value !== "object") return [];
            const track = value as Partial<MusicTrack>;
            const url = firstScalar(track.url);
            if (!url) return [];
            return [{
              name: firstScalar(track.name) || "QQ 音乐",
              artist: firstScalar(track.artist),
              url,
              cover: normalizeCoverUrl(firstScalar(track.cover)),
              lrc: firstScalar(track.lrc),
              key: firstScalar(track.key) || `qqvip:${spec.id}:${index}`,
            }];
          })
        : [];
      if (tracks.length === 0) throw new Error("未能获取 QQ 音乐歌单中的可播放歌曲");
      if (!spec.shuffle || tracks.length < 2) return tracks;
      return shuffleTracks(tracks);
    }
    const track = payload;
    if (!track.url || typeof track.url !== "string") throw new Error("未能获取 QQ 音乐播放地址");
    return [{
      name: firstScalar(track.name) || "QQ 音乐",
      artist: firstScalar(track.artist),
      url: track.url,
      cover: normalizeCoverUrl(firstScalar(track.cover)),
      lrc: firstScalar(track.lrc),
      key: `qqvip:${spec.id}`,
    }];
  }
  const res = await requestMetingTracks(metingApi, spec);
  if (!res.ok) throw new Error(`meting ${res.status}`);
  // 不同 Meting 实现可能返回数组或单个对象，封面字段也可能叫 cover、pic、image 或 album.pic。
  const raw = (await res.json()) as unknown;
  const data: MetingTrack[] = Array.isArray(raw)
    ? raw.filter((track): track is MetingTrack => Boolean(track && typeof track === "object"))
    : raw && typeof raw === "object"
      ? [raw as MetingTrack]
      : [];
  const tracks = data
    .filter((track) => typeof track.url === "string" && track.url.trim().length > 0)
    .map((track) => {
      const name = firstScalar(track.name) || "未知曲目";
      const artist = firstScalar(track.artist);
      const trackId = firstScalar(track.id, track.songid, track.mid);
      return {
        name,
        artist,
        url: (track.url as string).trim(),
        cover: normalizeCoverUrl(firstScalar(track.cover, track.pic, track.image, track.album?.pic, track.album?.picUrl)),
        lrc: firstScalar(track.lrc),
        key: trackId ? `${spec.server}:${trackId}` : `${spec.server}:${name}\u0000${artist}`,
      };
    });
  if (!spec.shuffle || tracks.length < 2) return tracks;
  return shuffleTracks(tracks);
}

function shuffleTracks<T>(tracks: T[]): T[] {
  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
