/**
 * 音乐内嵌：共享解析层。
 *
 * 文章用 Markdown 代码块：
 *   ```music
 *   netease:2280519151:playlist
 *   ```
 * 想法用正文独占行标记：`!music netease:1234567:song`
 *
 * 格式 `<server>:<id>[:<type>]`，type 缺省为 song。前端 MusicInitializer
 * 读取渲染出的 `.blog-music` 容器上的 data-* 属性，调 Meting API 取音频并初始化 APlayer。
 */

export const DEFAULT_METING_API = "https://api.injahow.cn/meting/";

export const MUSIC_SERVERS = ["netease", "qq", "kugou", "kuwo", "xiami", "baidu"] as const;
export type MusicServer = (typeof MUSIC_SERVERS)[number];

export const MUSIC_TYPES = ["song", "playlist", "album", "search"] as const;
export type MusicType = (typeof MUSIC_TYPES)[number];

export interface MusicSpec {
  server: MusicServer;
  id: string;
  type: MusicType;
}

const SERVER_SET = new Set<string>(MUSIC_SERVERS);
const TYPE_SET = new Set<string>(MUSIC_TYPES);

/** 解析 `server:id:type` 规格，无效返回 null。type 缺省为 song。 */
export function parseMusicSpec(input: string): MusicSpec | null {
  const raw = input.trim();
  if (!raw) return null;
  const parts = raw.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 3) return null;
  const [server, id, type = "song"] = parts;
  if (!SERVER_SET.has(server)) return null;
  if (!/^\d+$/.test(id)) return null;
  if (!TYPE_SET.has(type)) return null;
  return { server: server as MusicServer, id, type: type as MusicType };
}

/** 文章 music 代码块内文本：每行一个规格，空行/无效行忽略。 */
export function parseMusicBlock(text: string): MusicSpec[] {
  const specs: MusicSpec[] = [];
  for (const line of text.split("\n")) {
    const spec = parseMusicSpec(line);
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
  return `<div class="blog-music" data-server="${spec.server}" data-id="${spec.id}" data-type="${spec.type}"></div>`;
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
 * 调 Meting API 拉取曲目并归一化为 MusicTrack[]。
 * 前端触发卡片与全局播放器的默认歌单都走这里，避免各自重复实现。
 */
export async function fetchMusicTracks(metingApi: string, spec: MusicSpec): Promise<MusicTrack[]> {
  const res = await fetch(buildMetingUrl(metingApi, spec), { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`meting ${res.status}`);
  // 不同 Meting 实现可能返回数组或单个对象，封面字段也可能叫 cover、pic、image 或 album.pic。
  const raw = (await res.json()) as unknown;
  const data: MetingTrack[] = Array.isArray(raw)
    ? raw.filter((track): track is MetingTrack => Boolean(track && typeof track === "object"))
    : raw && typeof raw === "object"
      ? [raw as MetingTrack]
      : [];
  return data
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
}
