import { isIP } from "node:net";
import {
  normalizeArticleReferenceSnapshot,
  type ArticleReferenceSnapshot,
} from "@/lib/article-reference";
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
    let response: Response;
    try {
      response = await safeRemoteFetch(current, {
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "accept-language": "zh-CN,zh;q=0.9,en;q=0.6",
          // 公众号页面和部分站点会拒绝没有浏览器 UA 的请求。
          "user-agent": "Mozilla/5.0 (compatible; YeziBlogReference/1.0; +https://yezi.me)",
        },
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("读取文章超时，请稍后重试");
      throw new Error("读取文章失败，请检查网址是否可访问");
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
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
  }
  throw new Error("读取文章失败");
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
