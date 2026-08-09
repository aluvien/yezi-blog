import { isIP } from "node:net";
import {
  normalizeArticleReferenceSnapshot,
  type ArticleReferenceSnapshot,
} from "@/lib/article-reference";

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

function blockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (["metadata.google.internal", "metadata.google", "instance-data.ec2.internal"].includes(host)) return true;

  const ipVersion = isIP(host);
  if (ipVersion === 6) return true; // 文章元信息不需要访问 IPv6 字面量，直接避免本地 IPv6 绕过。
  if (ipVersion !== 4) return false;
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31
    || a === 192 && b === 168 || a === 198 && (b === 18 || b === 19) || a >= 224;
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
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        cache: "no-store",
        redirect: "manual",
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

function readScriptValue(html: string, name: string): string {
  const pattern = new RegExp(`(?:var\\s+)?${name}\\s*=\\s*["']([\\s\\S]*?)["']`, "i");
  const match = html.match(pattern);
  if (!match) return "";
  return decodeEntities(match[1].replace(/\\(['"\\])/g, "$1").replace(/\\n/g, " ").trim());
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

function extractArticleText(html: string): string {
  // 微信正文通常位于 #js_content；若页面结构不同，退回到整个 HTML 的可读文本。
  const contentMatch = html.match(/<[^>]+id\s*=\s*["']js_content["'][^>]*>([\s\S]{0,240000})/i);
  const source = contentMatch?.[1] || html;
  return stripHtml(source).slice(0, 20_000);
}

export async function fetchReferenceDocument(input: string): Promise<ArticleReferenceDocument> {
  const requestedUrl = normalizeReferenceUrl(input);
  const { html, finalUrl } = await fetchHtml(requestedUrl);
  const parsedUrl = new URL(finalUrl);
  const titleTag = stripHtml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const title = readMeta(html, ["og:title", "twitter:title"]) || readScriptValue(html, "msg_title") || titleTag;
  const source = readMeta(html, ["og:site_name", "application-name"]) || readScriptValue(html, "nickname") || (parsedUrl.hostname.includes("weixin.qq.com") || parsedUrl.hostname.includes("weixin.com") ? "微信公众号" : parsedUrl.hostname);
  const description = readMeta(html, ["og:description", "twitter:description", "description"]) || readScriptValue(html, "msg_desc");
  const cover = resolveHttpUrl(readMeta(html, ["og:image", "twitter:image"]) || readScriptValue(html, "msg_cdn_url"), finalUrl);
  const author = readMeta(html, ["author", "article:author"]) || readScriptValue(html, "author");
  const publishedAt = stripHtml(html.match(/id\s*=\s*["']publish_time["'][^>]*>([\s\S]*?)<\//i)?.[1] ?? "") || readMeta(html, ["article:published_time", "date"]) || readScriptValue(html, "ct");
  const canonical = resolveHttpUrl(readCanonical(html) || readMeta(html, ["og:url"]), finalUrl) || finalUrl;
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
  return { snapshot, text: extractArticleText(html) };
}
