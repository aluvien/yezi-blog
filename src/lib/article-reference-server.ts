import { isIP } from "node:net";
import { marked } from "marked";
import {
  normalizeArticleReferenceSnapshot,
  type ArticleReferenceSnapshot,
} from "@/lib/article-reference";
import { parseXStatusUrl, type XStatusUrl } from "@/lib/article-reference-url";
import { assertPublicRemoteUrl, isBlockedNetworkAddress } from "@/lib/remote-url";
import { safeRemoteFetch } from "@/lib/remote-fetch";

// 引用卡片只需要网页头部元信息和正文的一小段内容。保留读取上限，
// 但不要因为网页声明了较大的 Content-Length 就直接拒绝；不少站点会把
// 脚本、初始状态或内嵌资源一起放进 HTML，声明大小不代表元信息不可读。
const MAX_HTML_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

export interface ArticleReferenceDocument {
  snapshot: ArticleReferenceSnapshot;
  text: string;
}

/** 仅供服务端归档逻辑使用，绝不能直接回传给前台。 */
export interface ArticleReferenceArchiveDocument extends ArticleReferenceDocument {
  html: string;
  finalUrl: string;
}

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (["metadata.google.internal", "metadata.google", "instance-data.ec2.internal"].includes(host)) return true;

  const ipVersion = isIP(host);
  return ipVersion > 0 ? isBlockedNetworkAddress(host) : false;
}

export function normalizeReferenceUrl(input: unknown): string {
  const raw = String(input ?? "").trim();
  if (!raw || raw.length > 2_000) throw new Error("引用网址过长");
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("请输入有效的 http 或 https 网址");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("引用网址只支持 http 或 https");
  if (url.username || url.password || blockedHost(url.hostname)) throw new Error("这个网址不允许读取");
  const xStatus = parseXStatusUrl(url.toString());
  if (xStatus) return xStatus.canonicalUrl;
  url.hash = "";
  return url.toString();
}

async function readLimitedText(response: Response): Promise<string> {
  if (!response.body) {
    const text = await response.text();
    const bytes = new TextEncoder().encode(text);
    return new TextDecoder().decode(bytes.subarray(0, MAX_HTML_BYTES));
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        const remaining = MAX_HTML_BYTES - size;
        if (remaining <= 0) {
          await reader.cancel();
          break;
        }
        if (value.byteLength > remaining) {
          chunks.push(value.subarray(0, remaining));
          size += remaining;
          await reader.cancel();
          break;
        }
        size += value.byteLength;
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

async function fetchHtml(input: string): Promise<{ html: string; finalUrl: string }> {
  let current = normalizeReferenceUrl(input);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    // 文本检查挡不住“公网域名解析到 127.0.0.1/内网”的 SSRF 绕过；
    // 每次请求和每次跳转前都重新校验 DNS 解析结果。
    current = await assertPublicRemoteUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await safeRemoteFetch(current, {
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          // 公众号页面和部分站点会拒绝没有浏览器 UA 的请求。
          "user-agent": "Mozilla/5.0 (compatible; YeziBlogReference/1.0; +https://yezi.me)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location || redirect === MAX_REDIRECTS) throw new Error("文章跳转次数过多");
        current = normalizeReferenceUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`文章页面返回 ${response.status}`);
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
        throw new Error("这个链接不是网页文章");
      }
      return { html: await readLimitedText(response), finalUrl: current };
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
        throw new Error("读取文章超时，请稍后重试");
      }
      if (error instanceof Error && /跳转|不是网页|页面返回|过大/.test(error.message)) throw error;
      throw new Error("读取文章失败，请检查网址是否可访问");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("读取文章失败");
}

type XEntityLink = { url: string; expandedUrl: string; displayUrl: string };
type XStatusData = {
  id: string;
  text: string;
  title: string;
  articleHtml: string;
  author: string;
  username: string;
  authorAvatar: string;
  publishedAt: string;
  links: XEntityLink[];
  media: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringValue(record: Record<string, unknown> | null, keys: string[]): string {
  if (!record) return "";
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] || character);
}

function normalizeExternalDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const numeric = /^\d{10,13}$/.test(raw)
    ? Number(raw) * (raw.length === 10 ? 1_000 : 1)
    : Number.NaN;
  const timestamp = Number.isFinite(numeric) ? numeric : Date.parse(raw);
  if (!Number.isFinite(timestamp)) return raw;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : raw;
}

function collectXEntityLinks(tweet: Record<string, unknown>): XEntityLink[] {
  const entities = asRecord(tweet.entities);
  const candidates: unknown[] = [];
  if (entities) {
    candidates.push(entities.urls);
    // FxTwitter places facets and URL entities in slightly different shapes;
    // accepting both keeps the text readable when one provider changes format.
    candidates.push(entities.media);
  }
  const rawText = asRecord(tweet.raw_text);
  if (rawText) candidates.push(rawText.facets);
  const links: XEntityLink[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const item of candidate) {
      const record = asRecord(item);
      if (!record) continue;
      const url = stringValue(record, ["url", "original"]);
      const expandedCandidate = stringValue(record, ["expanded_url", "replacement", "display_url"]);
      const expandedUrl = /^https?:\/\//i.test(expandedCandidate) ? expandedCandidate : url;
      const displayUrl = stringValue(record, ["display_url", "display"]) || expandedUrl;
      if (/^https?:\/\//i.test(url) && /^https?:\/\//i.test(expandedUrl)) links.push({ url, expandedUrl, displayUrl });
    }
  }
  return [...new Map(links.map((link) => [link.url, link])).values()];
}

function trimUrlPunctuation(value: string): { url: string; suffix: string } {
  const match = value.match(/[),.!?，。！？；：、】》]+$/u);
  if (!match) return { url: value, suffix: "" };
  return { url: value.slice(0, -match[0].length), suffix: match[0] };
}

function xInlineHtml(value: string, links: XEntityLink[]): string {
  const parts: string[] = [];
  let cursor = 0;
  const urlPattern = /https?:\/\/[^\s<]+/giu;
  for (const match of value.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const trimmed = trimUrlPunctuation(raw);
    parts.push(escapeHtml(value.slice(cursor, index)));
    const entity = links.find((link) => link.url === trimmed.url || link.expandedUrl === trimmed.url);
    const href = entity?.expandedUrl || trimmed.url;
    const label = entity?.displayUrl || trimmed.url;
    parts.push(`<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`);
    parts.push(escapeHtml(trimmed.suffix));
    cursor = index + raw.length;
  }
  parts.push(escapeHtml(value.slice(cursor)));
  return parts.join("");
}

function xTextHtml(text: string, links: XEntityLink[]): string {
  const paragraphs = text
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.split(/\r?\n/u).map((line) => xInlineHtml(line, links)).join("<br>"))
    .filter(Boolean);
  return paragraphs.map((paragraph) => `<p>${paragraph}</p>`).join("");
}

type XArticleEntity = Record<string, unknown>;

function xArticleEntityMap(value: unknown): Map<string, XArticleEntity> {
  const map = new Map<string, XArticleEntity>();
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      const key = stringValue(record, ["key"]);
      const entity = asRecord(record?.value);
      if (key && entity) map.set(key, entity);
    }
    return map;
  }
  const record = asRecord(value);
  if (!record) return map;
  for (const [key, entityValue] of Object.entries(record)) {
    const entity = asRecord(entityValue);
    if (entity) map.set(key, entity);
  }
  return map;
}

function xArticleMediaMap(article: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>();
  const append = (value: unknown) => {
    const record = asRecord(value);
    if (!record) return;
    const info = asRecord(record.media_info);
    const id = stringValue(record, ["media_id", "id"]);
    const url = stringValue(info, ["original_img_url", "media_url_https", "media_url", "url"])
      || stringValue(record, ["url", "media_url_https", "media_url"]);
    if (id && /^https?:\/\//i.test(url)) map.set(id, url);
  };
  append(article.cover_media);
  if (Array.isArray(article.media_entities)) article.media_entities.forEach(append);
  return map;
}

function xArticleMediaUrls(article: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const append = (value: unknown) => {
    const record = asRecord(value);
    if (!record) return;
    const info = asRecord(record.media_info);
    const url = stringValue(info, ["original_img_url", "media_url_https", "media_url", "url"])
      || stringValue(record, ["url", "media_url_https", "media_url"]);
    if (/^https?:\/\//i.test(url)) urls.push(url);
  };
  append(article.cover_media);
  if (Array.isArray(article.media_entities)) article.media_entities.forEach(append);
  return [...new Set(urls)].slice(0, 30);
}

function xArticleBlockEntity(block: Record<string, unknown>, entities: Map<string, XArticleEntity>): XArticleEntity | null {
  const ranges = Array.isArray(block.entityRanges) ? block.entityRanges : [];
  const first = asRecord(ranges[0]);
  const key = stringValue(first, ["key"]);
  return key ? entities.get(key) || null : null;
}

function xBlockInlineHtml(
  block: Record<string, unknown>,
  entities: Map<string, XArticleEntity>,
  links: XEntityLink[],
): string {
  const text = stringValue(block, ["text"]);
  if (!text) return "";
  const entityRanges = (Array.isArray(block.entityRanges) ? block.entityRanges : [])
    .map(asRecord)
    .filter((range): range is Record<string, unknown> => Boolean(range));
  const styleRanges = (Array.isArray(block.inlineStyleRanges) ? block.inlineStyleRanges : [])
    .map(asRecord)
    .filter((range): range is Record<string, unknown> => Boolean(range));
  const boundaries = new Set<number>([0, text.length]);
  for (const range of [...entityRanges, ...styleRanges]) {
    const offset = Number(range.offset);
    const length = Number(range.length);
    if (!Number.isInteger(offset) || !Number.isInteger(length) || length <= 0) continue;
    boundaries.add(Math.max(0, Math.min(text.length, offset)));
    boundaries.add(Math.max(0, Math.min(text.length, offset + length)));
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const output: string[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const segment = text.slice(start, end);
    if (!segment) continue;
    const entityRange = entityRanges.find((range) => {
      const offset = Number(range.offset);
      const length = Number(range.length);
      return start >= offset && start < offset + length;
    });
    const entity = entityRange ? entities.get(stringValue(entityRange, ["key"])) : null;
    const entityData = asRecord(entity?.data);
    const entityUrl = stringValue(entityData, ["url"]);
    let rendered = entity?.type === "LINK" && /^https?:\/\//i.test(entityUrl)
      ? `<a href="${escapeHtml(entityUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(segment)}</a>`
      : xInlineHtml(segment, links);
    const activeStyles = styleRanges
      .filter((range) => {
        const offset = Number(range.offset);
        const length = Number(range.length);
        return start >= offset && start < offset + length;
      })
      .map((range) => stringValue(range, ["style"]).toLowerCase());
    if (activeStyles.some((style) => style.includes("bold"))) rendered = `<strong>${rendered}</strong>`;
    if (activeStyles.some((style) => style.includes("italic"))) rendered = `<em>${rendered}</em>`;
    if (activeStyles.some((style) => style.includes("strike"))) rendered = `<del>${rendered}</del>`;
    if (activeStyles.some((style) => style === "code" || style.includes("monospace"))) rendered = `<code>${rendered}</code>`;
    output.push(rendered);
  }
  return output.join("");
}

function xArticleMarkdownEntityHtml(markdown: string): string {
  if (!markdown.trim()) return "";
  // X 长文的 MARKDOWN entity 主要承载代码块；统一交给同一个 GFM 解析器，
  // 后续仍会经过归档白名单清洗，并最终转回本站的 reader_markdown。
  return String(marked.parse(markdown, { async: false, gfm: true, breaks: false }));
}

function renderXArticle(article: Record<string, unknown>, links: XEntityLink[]): { html: string; text: string; media: string[] } {
  const content = asRecord(article.content);
  const blocks = Array.isArray(content?.blocks)
    ? content.blocks.map(asRecord).filter((block): block is Record<string, unknown> => Boolean(block))
    : [];
  if (blocks.length === 0) return { html: "", text: "", media: xArticleMediaUrls(article) };
  const entities = xArticleEntityMap(content?.entityMap);
  const mediaById = xArticleMediaMap(article);
  const html: string[] = [];
  const text: string[] = [];
  const media: string[] = [];
  const appendMedia = (entity: XArticleEntity | null) => {
    const data = asRecord(entity?.data);
    const items = Array.isArray(data?.mediaItems) ? data.mediaItems : [];
    for (const item of items) {
      const mediaItem = asRecord(item);
      const url = mediaById.get(stringValue(mediaItem, ["mediaId", "media_id"]));
      if (!url || media.includes(url)) continue;
      media.push(url);
      html.push(`<figure><img src="${escapeHtml(url)}" alt="X 图片 ${media.length}"></figure>`);
    }
  };
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const type = stringValue(block, ["type"]).toLowerCase();
    if (type === "atomic") {
      const entity = xArticleBlockEntity(block, entities);
      const entityType = stringValue(entity, ["type"]).toUpperCase();
      if (entityType === "DIVIDER") html.push("<hr>");
      else if (entityType === "MARKDOWN") {
        const markdown = stringValue(asRecord(entity?.data), ["markdown"]);
        if (markdown) {
          html.push(xArticleMarkdownEntityHtml(markdown));
          text.push(markdown.replace(/```[\w+-]*\s*/g, "").replace(/```/g, "").trim());
        }
      } else if (entityType === "MEDIA") appendMedia(entity);
      continue;
    }
    if (type === "unordered-list-item" || type === "ordered-list-item") {
      const tag = type === "ordered-list-item" ? "ol" : "ul";
      const items: string[] = [];
      while (index < blocks.length && stringValue(blocks[index], ["type"]).toLowerCase() === type) {
        const itemText = stringValue(blocks[index], ["text"]);
        if (itemText.trim()) {
          items.push(`<li>${xBlockInlineHtml(blocks[index], entities, links)}</li>`);
          text.push(itemText);
        }
        index += 1;
      }
      index -= 1;
      if (items.length > 0) html.push(`<${tag}>${items.join("")}</${tag}>`);
      continue;
    }
    const blockText = stringValue(block, ["text"]);
    if (!blockText.trim()) continue;
    const tag = type === "header-one" ? "h1"
      : type === "header-two" ? "h2"
        : type === "header-three" ? "h3"
          : type === "header-four" ? "h4"
            : type === "blockquote" ? "blockquote" : "p";
    html.push(`<${tag}>${xBlockInlineHtml(block, entities, links)}</${tag}>`);
    text.push(blockText);
  }
  return { html: html.join(""), text: text.join("\n\n").trim(), media: [...new Set([...xArticleMediaUrls(article), ...media])].slice(0, 30) };
}

function collectXMedia(tweet: Record<string, unknown>): string[] {
  const media = asRecord(tweet.media);
  const candidates = [tweet.photos, tweet.mediaDetails, tweet.media, media?.all, media?.photos, media?.external];
  const urls: string[] = [];
  const add = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(add);
      return;
    }
    if (typeof value === "string") {
      if (/^https?:\/\//i.test(value)) urls.push(value);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    const type = stringValue(record, ["type", "media_type"]).toLowerCase();
    const source = /video|gif/.test(type)
      ? stringValue(record, ["thumbnail_url", "preview_image_url", "media_url_https", "media_url", "url"])
      : stringValue(record, ["url", "media_url_https", "media_url", "thumbnail_url"]);
    if (/^https?:\/\//i.test(source)) urls.push(source);
  };
  candidates.forEach(add);
  return [...new Set(urls)].slice(0, 4);
}

function parseXStatusPayload(payload: unknown, fallback: XStatusUrl): XStatusData | null {
  const root = asRecord(payload);
  const tweet = asRecord(root?.tweet) || root;
  if (!tweet) return null;
  const user = asRecord(tweet.user) || asRecord(tweet.author) || asRecord(root?.author);
  const rawText = asRecord(tweet.raw_text);
  const statusText = stringValue(tweet, ["text", "full_text"]) || stringValue(rawText, ["text"]);
  const article = asRecord(tweet.article);
  const articleTitle = stringValue(article, ["title", "name"]);
  const articlePreview = stringValue(article, ["preview_text", "description"]);
  const articleContent = article ? renderXArticle(article, collectXEntityLinks(tweet)) : { html: "", text: "", media: [] };
  const text = articleContent.text || [articleTitle, articlePreview, statusText].filter(Boolean).join("\n\n");
  if (!text) return null;
  const username = stringValue(user, ["screen_name", "username", "handle"]) || fallback.username;
  const authorName = stringValue(user, ["name", "display_name"]) || (username ? `@${username}` : "X 用户");
  const authorAvatar = stringValue(user, ["profile_image_url_https", "profile_image_url", "avatar_url", "avatar"]);
  const publishedAt = normalizeExternalDate(
    stringValue(tweet, ["created_at", "created_timestamp", "date"]) || stringValue(article, ["created_at", "created_timestamp", "date"]),
  );
  const media = articleContent.media.length > 0 ? articleContent.media : collectXMedia(tweet);
  return {
    id: stringValue(tweet, ["id_str", "id"]) || fallback.id,
    text,
    title: articleTitle,
    articleHtml: articleContent.html,
    author: authorName,
    username,
    authorAvatar,
    publishedAt,
    links: collectXEntityLinks(tweet),
    media,
  };
}

async function fetchRemoteJson(input: string): Promise<unknown> {
  await assertPublicRemoteUrl(input);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await safeRemoteFetch(input, {
      signal: controller.signal,
      headers: {
        accept: "application/json,text/plain;q=0.9,*/*;q=0.1",
        "user-agent": "Mozilla/5.0 (compatible; YeziBlogReference/1.0; +https://yezi.me)",
      },
    });
    if (!response.ok) throw new Error(`远程接口返回 ${response.status}`);
    return JSON.parse(await readLimitedText(response)) as unknown;
  } finally {
    clearTimeout(timer);
  }
}

function xSyndicationToken(id: string): string {
  const numeric = Number(id);
  return Number.isFinite(numeric) ? (numeric / 1e15 * Math.PI).toString(36) : "";
}

async function fetchXStatusData(status: XStatusUrl): Promise<XStatusData> {
  const token = xSyndicationToken(status.id);
  const syndicationUrl = `https://cdn.syndication.twimg.com/tweet-result?id=${status.id}&lang=zh-cn${token ? `&token=${encodeURIComponent(token)}` : ""}`;
  const apiUrl = `https://api.fxtwitter.com/${encodeURIComponent(status.username || "i")}/status/${status.id}`;
  const errors: string[] = [];
  let degraded: XStatusData | null = null;
  for (const endpoint of [syndicationUrl, apiUrl]) {
    try {
      const parsed = parseXStatusPayload(await fetchRemoteJson(endpoint), status);
      if (parsed) {
        // Syndication API 能返回普通短帖和长文元信息，但长文正文只在部分响应中提供；
        // 保留一个可显示的降级结果，同时继续请求 FxTwitter 获取完整 blocks/图片。
        if (parsed.articleHtml || !parsed.title) return parsed;
        degraded ||= parsed;
      }
      errors.push("响应中没有动态正文");
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "接口读取失败");
    }
  }
  if (degraded) return degraded;
  throw new Error(`X 动态读取失败，请稍后重试（${errors[errors.length - 1] || "公开接口无响应"}）`);
}

async function fetchXReferenceSource(status: XStatusUrl): Promise<ArticleReferenceArchiveDocument> {
  const data = await fetchXStatusData(status);
  const username = data.username || status.username;
  const canonicalUrl = username
    ? `https://x.com/${encodeURIComponent(username)}/status/${data.id}`
    : status.canonicalUrl;
  const title = data.title || data.text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || `${data.author} 的 X 动态`;
  // Provider payloads are intentionally parsed into a small, trusted shape above;
  // this HTML is only an intermediate representation for the existing sanitizer
  // and HTML-to-Markdown archive pipeline.
  const body = data.articleHtml || xTextHtml(data.text, data.links);
  const cover = data.media[0] && !body.includes(data.media[0])
    ? `<figure><img src="${escapeHtml(data.media[0])}" alt="X 文章封面"></figure>`
    : "";
  const media = data.articleHtml
    ? cover
    : data.media.map((url, index) => `<figure><img src="${escapeHtml(url)}" alt="X 图片 ${index + 1}"></figure>`).join("");
  const html = `<article>${body}${cover && data.articleHtml ? cover : media}<p><a href="${escapeHtml(canonicalUrl)}">查看 X 原文 ↗</a></p></article>`;
  const snapshot = normalizeArticleReferenceSnapshot({
    url: canonicalUrl,
    canonicalUrl,
    title,
    source: "X",
    author: data.author + (username ? ` (@${username})` : ""),
    publishedAt: data.publishedAt,
    cover: data.media[0] || data.authorAvatar,
    description: data.text,
  });
  return { snapshot, text: data.text, html, finalUrl: canonicalUrl };
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  };
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_match, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function parseAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attributes;
}

function readMeta(html: string, keys: string[]): string {
  const expected = new Set(keys.map((key) => key.toLowerCase()));
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const name = (attrs.property || attrs.name || attrs.itemprop || "").toLowerCase();
    if (expected.has(name) && attrs.content) return attrs.content.trim();
  }
  return "";
}

function readCanonical(html: string): string {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    if ((attrs.rel || "").toLowerCase().split(/\s+/).includes("canonical") && attrs.href) return attrs.href;
  }
  return "";
}

function readLink(html: string, relations: string[]): string {
  const expected = new Set(relations.map((relation) => relation.toLowerCase()));
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(match[0]);
    const rel = (attrs.rel || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (rel.some((value) => expected.has(value)) && attrs.href) return attrs.href.trim();
  }
  return "";
}

function readScriptValue(html: string, name: string): string {
  const pattern = new RegExp(`(?:var\\s+)?${name}\\s*=\\s*["']([\\s\\S]*?)["']`, "i");
  const match = html.match(pattern);
  if (!match) return "";
  return decodeEntities(match[1].replace(/\\(['"\\])/g, "$1").replace(/\\n/g, " ").trim());
}

function readImageSource(attributes: Record<string, string>): string {
  const srcset = attributes["data-srcset"] || attributes.srcset || "";
  const srcsetUrl = srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
  return attributes["data-src"] || attributes["data-original"] || attributes["data-lazy-src"]
    || attributes["data-actualsrc"] || attributes["data-url"] || attributes.src || srcsetUrl;
}

function comparableText(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\u00a0]+/g, "").trim();
}

function readAuthorAvatarFromMarkup(html: string, baseUrl: string, author = ""): string {
  const images = [...html.matchAll(/<img\b[^>]*>/gi)];
  const comparableAuthor = comparableText(author);

  // 很多博客只把作者名放在头像的 alt 属性里，不使用 avatar/profile class。
  // 先按作者名匹配，避免把文章正文中的第一张图片误当成头像。
  if (comparableAuthor.length >= 2) {
    for (const match of images) {
      const attributes = parseAttributes(match[0]);
      const candidates = [attributes.alt, attributes.title, attributes["data-author"]]
        .filter(Boolean)
        .map(comparableText);
      if (!candidates.some((candidate) => candidate === comparableAuthor || candidate.includes(comparableAuthor) || comparableAuthor.includes(candidate))) continue;
      const source = resolveHttpUrl(readImageSource(attributes), baseUrl);
      if (source) return source;
    }
  }

  for (const match of images) {
    const index = match.index ?? 0;
    const attributes = parseAttributes(match[0]);
    const hint = [attributes.class, attributes.id, attributes.alt, attributes.title, attributes.itemprop, attributes["data-author"]]
      .filter(Boolean)
      .join(" ");
    const context = html.slice(Math.max(0, index - 600), Math.min(html.length, index + match[0].length + 300));
    if (!/(?:author|avatar|profile|byline|post-author|head[_-]?(?:img|image)|user[_-]?image)/i.test(`${hint} ${context}`)) continue;
    const source = resolveHttpUrl(readImageSource(attributes), baseUrl);
    if (source) return source;
  }
  return "";
}

function stripHtml(value: string): string {
  return decodeEntities(value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function readTimeValue(html: string): string {
  for (const match of html.matchAll(/<time\b([^>]*)>([\s\S]*?)<\/time>/gi)) {
    const attributes = parseAttributes(match[0]);
    const value = attributes.datetime || stripHtml(match[2] ?? "");
    if (value.trim()) return value.trim();
  }
  return "";
}

function resolveHttpUrl(value: string, base: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

type JsonLdArticleInfo = {
  title: string;
  source: string;
  author: string;
  authorAvatar: string;
  publishedAt: string;
  cover: string;
  description: string;
};

function readJsonLdArticleInfo(html: string, baseUrl: string): JsonLdArticleInfo {
  const candidates: Record<string, unknown>[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(append);
    else if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      candidates.push(object);
      append(object["@graph"]);
    }
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json'|application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      append(JSON.parse(match[1]));
    } catch {
      // 第三方页面的 JSON-LD 可能不完整，跳过而不是影响正常 meta 解析。
    }
  }
  const isArticle = (value: Record<string, unknown>) => {
    const rawType = value["@type"];
    const types = Array.isArray(rawType) ? rawType : [rawType];
    return types.some((type) => /article|newsarticle|blogposting/i.test(String(type ?? "")));
  };
  const article = candidates.find(isArticle) ?? candidates.find((value) => Boolean(value.headline || value.articleBody)) ?? {};
  const nameOf = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return nameOf(value[0]);
    if (value && typeof value === "object") return String((value as Record<string, unknown>).name ?? "");
    return "";
  };
  const imageOf = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return imageOf(value[0]);
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      return String(object.url ?? object.contentUrl ?? object["@id"] ?? "");
    }
    return "";
  };
  const authorImageOf = (value: unknown): string => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const image = authorImageOf(item);
        if (image) return image;
      }
      return "";
    }
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      return imageOf(object.image ?? object.avatar ?? object.photo ?? object.thumbnailUrl);
    }
    return "";
  };
  return {
    title: String(article.headline ?? article.name ?? ""),
    source: nameOf(article.publisher) || nameOf(article.isPartOf),
    author: nameOf(article.author),
    authorAvatar: resolveHttpUrl(authorImageOf(article.author), baseUrl),
    publishedAt: String(article.datePublished ?? article.dateCreated ?? ""),
    cover: resolveHttpUrl(imageOf(article.image ?? article.thumbnailUrl), baseUrl),
    description: String(article.description ?? ""),
  };
}

function fallbackSiteIcon(baseUrl: string, html: string): string {
  const icon = readLink(html, ["icon", "shortcut", "apple-touch-icon", "apple-touch-icon-precomposed", "mask-icon"]);
  if (icon) return resolveHttpUrl(icon, baseUrl);
  try {
    const origin = new URL(baseUrl).origin;
    return `${origin}/favicon.ico`;
  } catch {
    return "";
  }
}

function extractArticleText(html: string): string {
  // 微信正文通常位于 #js_content；若页面结构不同，退回到整个 HTML 的可读文本。
  const contentMatch = html.match(/<[^>]+id\s*=\s*["']js_content["'][^>]*>([\s\S]{0,240000})/i);
  const source = contentMatch?.[1] || html;
  return stripHtml(source).slice(0, 20_000);
}

async function fetchReferenceSource(input: string): Promise<ArticleReferenceArchiveDocument> {
  const requestedUrl = normalizeReferenceUrl(input);
  const xStatus = parseXStatusUrl(requestedUrl);
  if (xStatus) return fetchXReferenceSource(xStatus);
  const { html, finalUrl } = await fetchHtml(requestedUrl);
  const parsedUrl = new URL(finalUrl);
  const jsonLd = readJsonLdArticleInfo(html, finalUrl);
  const titleTag = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const title = readMeta(html, ["og:title", "twitter:title"]) || readScriptValue(html, "msg_title") || jsonLd.title || titleTag;
  const source = readMeta(html, ["og:site_name", "application-name", "twitter:site"]) || readScriptValue(html, "nickname") || jsonLd.source || (parsedUrl.hostname.includes("weixin.qq.com") || parsedUrl.hostname.includes("weixin.com") ? "微信公众号" : parsedUrl.hostname);
  const description = readMeta(html, ["og:description", "twitter:description", "description"]) || readScriptValue(html, "msg_desc") || jsonLd.description;
  const parsedCover = resolveHttpUrl(readMeta(html, ["og:image", "twitter:image", "image"]) || readScriptValue(html, "msg_cdn_url") || jsonLd.cover, finalUrl);
  const author = readMeta(html, ["author", "article:author", "twitter:creator", "parsely-author"]) || readScriptValue(html, "author") || jsonLd.author;
  const authorAvatar = resolveHttpUrl(
    readMeta(html, ["author:image", "article:author:image", "author_image", "author-avatar", "profile:image", "profile_image"])
      || readScriptValue(html, "profile_avatar")
      || readScriptValue(html, "author_avatar")
      || readScriptValue(html, "ori_head_img_url")
      || readScriptValue(html, "round_head_img_url")
      || jsonLd.authorAvatar
      || readAuthorAvatarFromMarkup(html, finalUrl, author),
    finalUrl,
  );
  const publishedAt = stripHtml(html.match(/id\s*=\s*["']publish_time["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? "") || readTimeValue(html) || readMeta(html, ["article:published_time", "date", "datepublished"]) || readScriptValue(html, "ct") || jsonLd.publishedAt;
  const canonical = resolveHttpUrl(readCanonical(html) || readMeta(html, ["og:url"]), finalUrl) || finalUrl;
  // 第三方页面没有明确封面时，优先使用目标页面作者头像，再回退到目标网站图标，
  // 不使用本站后台作者头像，避免不同来源的引用卡片被错误地标成本站作者。
  const cover = parsedCover || authorAvatar || fallbackSiteIcon(finalUrl, html) || "";
  const snapshot = normalizeArticleReferenceSnapshot({
    url: requestedUrl,
    canonicalUrl: canonical,
    title,
    source,
    author,
    publishedAt,
    cover,
    description,
  });
  return { snapshot, text: extractArticleText(html), html, finalUrl };
}

/** 读取用于卡片和 AI 摘要的安全文本；不将第三方原始 HTML 暴露给调用方。 */
export async function fetchReferenceDocument(input: string): Promise<ArticleReferenceDocument> {
  const document = await fetchReferenceSource(input);
  return { snapshot: document.snapshot, text: document.text };
}

/** 私有阅读归档使用，调用方必须确保结果只留在服务器本地。 */
export async function fetchReferenceArchiveDocument(input: string): Promise<ArticleReferenceArchiveDocument> {
  return fetchReferenceSource(input);
}
