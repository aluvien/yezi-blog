/**
 * QQ 音乐 VIP 内嵌：共享解析层。
 *
 * 文章用 Markdown 代码块：
 *   ```music
 *   qqvip:歌曲 MID:song
 *   ```
 *
 * 想法用正文独占行标记：`!music qqvip:歌曲 MID:song`。
 * 歌曲信息、播放地址和歌词均由本站 QQ 音乐适配器提供。
 */

export const MUSIC_SERVERS = ["qqvip"] as const;
export type MusicServer = (typeof MUSIC_SERVERS)[number];

export const MUSIC_TYPES = ["song", "playlist"] as const;
export type MusicType = (typeof MUSIC_TYPES)[number];

export interface MusicSpec {
  server: MusicServer;
  id: string;
  type: MusicType;
  shuffle?: boolean;
  /** QQ 搜索时随引用保存的展示快照，保证首屏无需再等详情接口。 */
  title?: string;
  artist?: string;
  cover?: string;
}

const SERVER_SET = new Set<string>(MUSIC_SERVERS);
const TYPE_SET = new Set<string>(MUSIC_TYPES);

/** Upstream labels eventually reach a legacy APlayer innerHTML sink; keep them strict plain text. */
export function normalizeMusicDisplayText(value: unknown, fallback = "", maxLength = 180): string {
  const raw = typeof value === "string" || typeof value === "number" ? String(value) : "";
  const text = raw.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text || fallback;
}

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
    const cover = /^https:\/\//i.test(candidateCover) ? compactMusicCoverUrl(candidateCover) : "";
    return title || artist || cover ? { title, artist, cover } : null;
  } catch {
    return null;
  }
}

/**
 * 供 QQ 搜索选择器生成音乐引用规格。
 *
 * 插入内容始终保持简短、可读的 `qqvip:id:song` 格式。展示信息由播放接口
 * 在前端加载，不把歌名、封面等冗长快照编码进文章正文。
 */
export function createQQMusicSpec(mid: string): string {
  const safeMid = mid.trim();
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(safeMid)) return "";
  return `qqvip:${safeMid}:song`;
}

/** 解析 `qqvip:id:type[:random]` 规格。 */
export function parseMusicSpec(input: string): MusicSpec | null {
  const raw = input.trim();
  if (!raw) return null;
  const parts = raw.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) return null;
  const [server, id, type = "song", mode] = parts;
  if (!SERVER_SET.has(server) || !/^[A-Za-z0-9_-]{4,80}$/.test(id) || !TYPE_SET.has(type)) return null;
  const metadata = qqMusicMetadata(mode);
  if (mode && mode !== "random" && mode !== "shuffle" && !metadata) return null;
  return {
    server: "qqvip",
    id,
    type: type as MusicType,
    shuffle: mode === "random" || mode === "shuffle",
    ...(metadata ?? {}),
  };
}

/** 文章 music 代码块内文本：每行一个 QQ VIP 规格，空行/无效行忽略。 */
export function parseMusicBlock(text: string): MusicSpec[] {
  return text.split("\n").flatMap((line) => {
    const spec = parseMusicSpec(line.trim());
    return spec ? [spec] : [];
  });
}

export type MomentSegment =
  | { kind: "text"; value: string }
  | { kind: "music"; value: MusicSpec };

/** 拆分想法正文中的 `!music qqvip:id:type`。 */
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

/** 服务端渲染音乐容器，QQ 搜索快照可在客户端请求前直接显示。 */
export function musicContainerHtml(spec: MusicSpec): string {
  const escapeAttribute = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] ?? character);
  const title = spec.title?.trim() ?? "";
  const artist = spec.artist?.trim() ?? "";
  const cover = compactMusicCoverUrl(spec.cover?.trim() ?? "");
  const snapshotAttributes = title || artist || cover
    ? ` data-music-name="${escapeAttribute(title)}" data-music-artist="${escapeAttribute(artist)}" data-music-cover="${escapeAttribute(cover)}"`
    : "";
  const fallback = title
    ? `<div class="music-trigger music-trigger-static"><span class="music-trigger-swipe-stage"><span class="music-trigger-swipe-slide" data-track-slot="current"><span class="music-trigger-cover${cover ? "" : " is-fallback"}">${cover ? `<img class="site-image-media site-image-loading" src="${escapeAttribute(cover)}" alt="">` : ""}</span><span class="music-trigger-info"><span class="music-trigger-name">${escapeAttribute(title)}</span><span class="music-trigger-artist"><span class="music-trigger-artist-name">${escapeAttribute(artist)}</span></span></span></span></span><span class="music-trigger-play" aria-hidden="true"></span></div>`
    : "";
  // Markdown 正文通过 dangerouslySetInnerHTML 注入，不属于 React 的可水合子树，
  // 因而可以由全局初始化器立即增强。React 组件渲染的容器则会在 useEffect 后自行标记。
  return `<div class="blog-music" data-hydrated="1" data-server="qqvip" data-id="${escapeAttribute(spec.id)}" data-type="${spec.type}" data-shuffle="${spec.shuffle ? "1" : "0"}"${snapshotAttributes}>${fallback}</div>`;
}

/** 归一化后的可播放曲目（与 APlayer 的 APlayerAudio 字段一致）。 */
export interface MusicTrack {
  name: string;
  artist: string;
  url: string;
  cover: string;
  lrc: string;
  /** 接口或浏览器音频元数据给出的秒数。 */
  duration?: number;
  /** 跨页面/跨请求保持稳定，用于避免同一首歌重复加入全局列表。 */
  key?: string;
}

function firstScalar(...values: unknown[]): string {
  const value = values.find((item) =>
    (typeof item === "string" && item.trim().length > 0) || typeof item === "number",
  );
  return value === undefined ? "" : String(value).trim();
}

function normalizeCoverUrl(value: string): string {
  if (value.startsWith("//")) return `https:${value}`;
  if (value.startsWith("http://")) return `https://${value.slice("http://".length)}`;
  return value;
}

/** 保留 QQ 接口返回的原始封面地址，避免改写成并非所有歌曲都支持的尺寸。 */
export function compactMusicCoverUrl(value: string): string {
  return normalizeCoverUrl(value);
}

/** 获取 QQ VIP 单曲或歌单，所有入口统一走本站 QQ 音乐适配器。 */
export async function fetchMusicTracks(spec: MusicSpec): Promise<MusicTrack[]> {
  if (spec.type !== "song" && spec.type !== "playlist") throw new Error("QQ 音乐登录播放暂支持单曲或歌单");
  const res = await fetch(`/api/music/qq?id=${encodeURIComponent(spec.id)}&type=${encodeURIComponent(spec.type)}`, {
    signal: AbortSignal.timeout(60_000),
    cache: "no-store",
  });
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
            name: normalizeMusicDisplayText(firstScalar(track.name), "QQ 音乐"),
            artist: normalizeMusicDisplayText(firstScalar(track.artist)),
            url,
            cover: compactMusicCoverUrl(firstScalar(track.cover)),
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
    name: normalizeMusicDisplayText(firstScalar(track.name) || spec.title, "QQ 音乐"),
    artist: normalizeMusicDisplayText(firstScalar(track.artist) || spec.artist),
    url: track.url,
    cover: compactMusicCoverUrl(firstScalar(track.cover) || spec.cover || ""),
    lrc: firstScalar(track.lrc),
    key: `qqvip:${spec.id}`,
  }];
}

function shuffleTracks<T>(tracks: T[]): T[] {
  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}
