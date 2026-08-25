/**
 * 文章视频嵌入：保存为 Markdown 代码块：
 *
 *   ```video
 *   bilibili:BV1xx411c7mD
 *   ```
 *
 *   ```video
 *   youtube:dQw4w9WgXcQ
 *   ```
 *
 * 只接受 Bilibili 与 YouTube 的视频 ID，渲染时由服务端生成固定的播放器地址。
 */

export const VIDEO_PLATFORMS = ["bilibili", "youtube"] as const;
export type VideoPlatform = (typeof VIDEO_PLATFORMS)[number];

export interface VideoSpec {
  platform: VideoPlatform;
  id: string;
  page?: number;
}

const VIDEO_PLATFORM_SET = new Set<string>(VIDEO_PLATFORMS);
const BILIBILI_ID_PATTERN = /^(?:BV[a-zA-Z0-9]+|av\d+)$/i;
const YOUTUBE_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

export function isBilibiliShortUrl(input: string): boolean {
  try {
    return new URL(input.trim()).hostname.toLowerCase() === "b23.tv";
  } catch {
    return false;
  }
}

function parseBilibiliInput(input: string): Pick<VideoSpec, "id" | "page"> | null {
  const direct = input.match(BILIBILI_ID_PATTERN);
  if (direct) return { id: direct[0] };

  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    // b23.tv uses opaque redirect IDs. Public rendering never performs network
    // expansion; the editor reports this as unsupported instead of silently
    // saving a shortcode that later renders as plain text.
    if (hostname === "b23.tv") return null;
    if (hostname !== "bilibili.com" && !hostname.endsWith(".bilibili.com")) return null;
    const match = url.pathname.match(/\/video\/(BV[a-zA-Z0-9]+|av\d+)/i);
    if (!match) return null;
    const pageValue = Number.parseInt(url.searchParams.get("p") ?? "1", 10);
    return {
      id: match[1],
      ...(Number.isInteger(pageValue) && pageValue > 1 ? { page: pageValue } : {}),
    };
  } catch {
    return null;
  }
}

function parseYoutubeInput(input: string): Pick<VideoSpec, "id"> | null {
  if (YOUTUBE_ID_PATTERN.test(input)) return { id: input };

  try {
    const url = new URL(input);
    const hostname = url.hostname.toLowerCase();
    let id = "";
    if (hostname === "youtu.be") {
      id = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } else if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      id = url.searchParams.get("v") ?? "";
      if (!id) {
        const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?]+)/i);
        id = match?.[1] ?? "";
      }
    }
    return YOUTUBE_ID_PATTERN.test(id) ? { id } : null;
  } catch {
    return null;
  }
}

/** 解析平台和链接/ID。也支持已保存的 `bilibili:id[:page]` / `youtube:id` 格式。 */
export function parseVideoSpec(input: string, platform?: VideoPlatform): VideoSpec | null {
  const raw = input.trim();
  if (!raw) return null;

  const parts = raw.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 3 && VIDEO_PLATFORM_SET.has(parts[0])) {
    const parsedPlatform = parts[0] as VideoPlatform;
    if (parsedPlatform === "bilibili" && BILIBILI_ID_PATTERN.test(parts[1])) {
      const page = parts[2] ? Number.parseInt(parts[2], 10) : 1;
      return Number.isInteger(page) && page > 0
        ? { platform: parsedPlatform, id: parts[1], ...(page > 1 ? { page } : {}) }
        : null;
    }
    if (parsedPlatform === "youtube" && YOUTUBE_ID_PATTERN.test(parts[1]) && parts.length === 2) {
      return { platform: parsedPlatform, id: parts[1] };
    }
    return null;
  }

  if (platform === "bilibili") {
    const parsed = parseBilibiliInput(raw);
    return parsed ? { platform, ...parsed } : null;
  }
  if (platform === "youtube") {
    const parsed = parseYoutubeInput(raw);
    return parsed ? { platform, ...parsed } : null;
  }

  const bilibili = parseBilibiliInput(raw);
  if (bilibili) return { platform: "bilibili", ...bilibili };
  const youtube = parseYoutubeInput(raw);
  return youtube ? { platform: "youtube", ...youtube } : null;
}

/** 构造固定的第三方播放器地址，不接受文章内容直接指定 iframe URL。 */
export function buildVideoEmbedUrl(spec: VideoSpec): string {
  if (spec.platform === "bilibili") {
    const url = new URL("https://player.bilibili.com/player.html");
    if (/^av\d+$/i.test(spec.id)) {
      url.searchParams.set("aid", spec.id.slice(2));
    } else {
      url.searchParams.set("bvid", spec.id);
    }
    url.searchParams.set("page", String(spec.page ?? 1));
    url.searchParams.set("high_quality", "1");
    url.searchParams.set("autoplay", "0");
    return url.toString();
  }
  const url = new URL(`https://www.youtube-nocookie.com/embed/${encodeURIComponent(spec.id)}`);
  url.searchParams.set("rel", "0");
  // 允许页面在音乐重新播放时通过 YouTube IFrame API 暂停视频。
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("playsinline", "1");
  return url.toString();
}

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

/** 将规范化的视频规格渲染为响应式 iframe。 */
export function videoContainerHtml(spec: VideoSpec): string {
  const title = spec.platform === "bilibili" ? "Bilibili 视频" : "YouTube 视频";
  return `<div class="blog-video"><iframe src="${escapeAttribute(buildVideoEmbedUrl(spec))}" data-video-platform="${spec.platform}" title="${title}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>`;
}

/** 视频代码块每行一个视频规格；无效行忽略。 */
export function parseVideoBlock(text: string): VideoSpec[] {
  return text
    .split("\n")
    .map((line) => parseVideoSpec(line))
    .filter((spec): spec is VideoSpec => spec !== null);
}
