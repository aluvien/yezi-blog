/**
 * 文章引用的共享格式。
 *
 * 引用快照以紧凑标记写进 Markdown，而不是让前台渲染时再次请求第三方网页。
 * 这样编辑器预览、服务端渲染和之后的文章访问都会使用同一份元数据，第三方
 * 网站临时不可用时也不会拖慢文章首屏。
 */

export interface ArticleReferenceSnapshot {
  url: string;
  canonicalUrl: string;
  title: string;
  source: string;
  author: string;
  publishedAt: string;
  cover: string;
  description: string;
  summary: string;
  keyPoints: string[];
}

/** 本站文章引用：只保留跳转所需的 slug 与简短提示信息，不进入外部引用库。 */
export interface SiteArticleReferenceSnapshot {
  slug: string;
  title: string;
  summary: string;
}

const MAX_TITLE_LENGTH = 240;
const MAX_SOURCE_LENGTH = 100;
const MAX_AUTHOR_LENGTH = 100;
const MAX_DATE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 800;
const MAX_POINT_LENGTH = 180;
const MAX_POINTS = 6;
const SITE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;

function text(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** 微信的 ct 字段是 Unix 时间戳，不能直接作为文章日期展示。 */
export function formatArticleReferenceDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  // 部分普通网站以 0/null 表示“没有发布时间”，不能把占位值直接展示给读者。
  if (!raw || /^0+$/.test(raw) || /^(?:null|undefined)$/i.test(raw)) return "";
  if (!/^\d{10,13}$/.test(raw)) return raw;
  const numeric = Number(raw);
  const date = new Date(raw.length === 13 ? numeric : numeric * 1_000);
  if (!Number.isFinite(date.getTime())) return raw;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  return year && month && day ? `${year}-${month}-${day}` : raw;
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.length > 2_000) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function normalizeAssetUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("/uploads/") && !raw.startsWith("//")) return raw;
  return normalizeUrl(raw);
}

/** 将外部接口返回的任意值收敛成可安全写入文章的引用快照。 */
export function normalizeArticleReferenceSnapshot(input: Partial<ArticleReferenceSnapshot>): ArticleReferenceSnapshot {
  const url = normalizeUrl(input.url);
  const canonicalUrl = normalizeUrl(input.canonicalUrl) || url;
  const points = Array.isArray(input.keyPoints)
    ? input.keyPoints.map((point) => text(point, MAX_POINT_LENGTH)).filter(Boolean).slice(0, MAX_POINTS)
    : [];
  return {
    url,
    canonicalUrl,
    title: text(input.title, MAX_TITLE_LENGTH) || "引用文章",
    source: text(input.source, MAX_SOURCE_LENGTH),
    author: text(input.author, MAX_AUTHOR_LENGTH),
    publishedAt: text(formatArticleReferenceDate(input.publishedAt), MAX_DATE_LENGTH),
    cover: normalizeAssetUrl(input.cover),
    description: text(input.description, MAX_DESCRIPTION_LENGTH),
    summary: text(input.summary, MAX_SUMMARY_LENGTH),
    keyPoints: points,
  };
}

export function normalizeSiteArticleReferenceSnapshot(input: Partial<SiteArticleReferenceSnapshot>): SiteArticleReferenceSnapshot | null {
  const slug = text(input.slug, 80).toLocaleLowerCase();
  if (!SITE_SLUG_PATTERN.test(slug)) return null;
  return {
    slug,
    title: text(input.title, MAX_TITLE_LENGTH) || "本站文章",
    summary: text(input.summary, MAX_DESCRIPTION_LENGTH),
  };
}

/**
 * 根据规范化网址生成稳定的短引用 ID。
 * 引用正文只保存这个 ID，完整快照继续放在文章引用缓存中，避免 Markdown 被长 URL 和 JSON 撑大。
 */
export function articleReferenceToken(input: Partial<ArticleReferenceSnapshot>): string {
  const snapshot = normalizeArticleReferenceSnapshot(input);
  const value = snapshot.canonicalUrl || snapshot.url;
  let first = 2166136261;
  let second = 2246822519;
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 3266489917);
  }
  return `r${(first >>> 0).toString(36).padStart(7, "0")}${(second >>> 0).toString(36).padStart(7, "0")}`;
}

export function encodeArticleReferenceMarker(input: Partial<ArticleReferenceSnapshot>): string {
  const snapshot = normalizeArticleReferenceSnapshot(input);
  return `!reference:${articleReferenceToken(snapshot)}`;
}

/** 本站文章引用使用独立的紧凑快照，不会被同步到 article_references 表。 */
export function encodeSiteArticleReferenceMarker(input: Partial<SiteArticleReferenceSnapshot>): string {
  const snapshot = normalizeSiteArticleReferenceSnapshot(input);
  if (!snapshot) return "";
  return `!site-reference:${encodeBase64Url(JSON.stringify({ s: snapshot.slug, t: snapshot.title, x: snapshot.summary }))}`;
}

export function decodeSiteArticleReferencePayload(payload: string): SiteArticleReferenceSnapshot | null {
  try {
    const parsed = JSON.parse(decodeBase64Url(payload)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    return normalizeSiteArticleReferenceSnapshot({
      slug: typeof record.s === "string" ? record.s : "",
      title: typeof record.t === "string" ? record.t : "",
      summary: typeof record.x === "string" ? record.x : "",
    });
  } catch {
    return null;
  }
}

export function decodeArticleReferencePayload(payload: string, references: readonly ArticleReferenceSnapshot[] = []): ArticleReferenceSnapshot | null {
  let parsed: Record<string, unknown> | null = null;
  try {
    const decoded = decodeURIComponent(payload);
    const value = JSON.parse(decoded) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
  } catch {
    // 新格式使用 base64url，继续尝试解码；旧格式仍由上面的 URI JSON 兼容处理。
  }
  if (!parsed) {
    try {
      const value = JSON.parse(decodeBase64Url(payload)) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value as Record<string, unknown>;
    } catch {
      // 短引用 ID 通过文章已保存的引用快照解析。
    }
  }
  if (!parsed) {
    const snapshot = references.find((reference) => articleReferenceToken(reference) === payload);
    return snapshot ? normalizeArticleReferenceSnapshot(snapshot) : null;
  }
  const compact = typeof parsed.u === "string" ? {
    url: parsed.u,
    canonicalUrl: parsed.c,
    title: parsed.t,
    source: parsed.s,
    author: parsed.a,
    publishedAt: parsed.d,
    cover: parsed.v,
    description: parsed.x,
    summary: parsed.y,
    keyPoints: parsed.p,
  } : parsed;
  const snapshot = normalizeArticleReferenceSnapshot(compact as Partial<ArticleReferenceSnapshot>);
  return snapshot.url ? snapshot : null;
}

function referenceMarkerRegex(): RegExp {
  // 每次都创建新实例，避免 matchAll/replace 的 lastIndex 影响后续渲染。
  return /^[ \t]*!reference(?::|[ \t]+)(\S+)[ \t]*$/gm;
}

function siteReferenceMarkerRegex(): RegExp {
  return /!site-reference(?::|[ \t]+)([A-Za-z0-9_-]+)/g;
}

/** 读取文章正文里已经插入的引用快照，供保存时写入 SQLite 缓存。 */
export function parseArticleReferenceMarkers(content: string, cachedReferences: readonly ArticleReferenceSnapshot[] = []): ArticleReferenceSnapshot[] {
  const snapshots: ArticleReferenceSnapshot[] = [];
  for (const match of content.matchAll(referenceMarkerRegex())) {
    const snapshot = decodeArticleReferencePayload(match[1], cachedReferences);
    if (snapshot) snapshots.push(snapshot);
  }
  return snapshots;
}

/** 将旧的长快照标记和短标记统一压缩成短引用 ID。 */
export function compactArticleReferenceMarkers(content: string, cachedReferences: readonly ArticleReferenceSnapshot[] = []): string {
  return content.replace(referenceMarkerRegex(), (line, payload: string) => {
    const snapshot = decodeArticleReferencePayload(payload, cachedReferences);
    return snapshot ? encodeArticleReferenceMarker(snapshot) : line;
  });
}

/** 把编辑器里的短标记转成 marked 可识别的自定义代码块。 */
export function expandArticleReferenceMarkers(content: string): string {
  return content.replace(referenceMarkerRegex(), (_line, payload: string) => {
    return `\n\`\`\`reference\n${payload}\n\`\`\`\n`;
  });
}

/**
 * 本站文章引用是真正的行内标记。先用纯文本占位符穿过 Markdown 与白名单清洗，
 * 最后再恢复为已转义的固定 HTML，避免把原始 HTML 放回作者正文中。
 */
export function expandSiteArticleReferenceMarkers(content: string, replacements: Map<string, string>): string {
  return content.replace(siteReferenceMarkerRegex(), (marker, payload: string) => {
    const snapshot = decodeSiteArticleReferencePayload(payload);
    if (!snapshot) return marker;
    const token = `YEZISITEREFERENCE${replacements.size}TOKEN`;
    replacements.set(token, siteArticleReferenceHtml(snapshot));
    return token;
  });
}

function escapeHtml(value: string): string {
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

function safeReferenceUrl(value: string): string | null {
  const normalized = normalizeUrl(value);
  return normalized || null;
}

function safeReferenceAssetUrl(value: string): string | null {
  if (value.startsWith("/uploads/") && !value.startsWith("//")) return value;
  return safeReferenceUrl(value);
}

export function articleReferenceCoverSrc(coverUrl: string, sourceUrl: string): string {
  if (coverUrl.startsWith("/uploads/")) return coverUrl;
  const params = new URLSearchParams({ url: coverUrl, referer: sourceUrl });
  return `/api/article-references/image?${params.toString()}`;
}

/** 生成简洁的本站文章链接；摘要交由全局提示层在悬停/触摸时展示。 */
export function siteArticleReferenceHtml(input: Partial<SiteArticleReferenceSnapshot>): string {
  const snapshot = normalizeSiteArticleReferenceSnapshot(input);
  if (!snapshot) return "";
  const href = `/posts/${encodeURIComponent(snapshot.slug)}`;
  const hint = snapshot.summary || "点击前往阅读全文";
  return `<span class="site-article-reference"><a class="site-article-reference-link" href="${escapeHtml(href)}" aria-label="${escapeHtml(`${snapshot.title}。${hint}`)}"><svg class="site-article-reference-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7"></path><path d="M8 7h9v9"></path></svg><span>${escapeHtml(snapshot.title)}</span></a><span class="site-article-reference-tooltip" role="tooltip">${escapeHtml(hint)}</span></span>`;
}

/** 生成前台和后台预览共用的引用卡片 HTML。 */
export function articleReferenceCardHtml(input: Partial<ArticleReferenceSnapshot>): string {
  const snapshot = normalizeArticleReferenceSnapshot(input);
  const sourceUrl = safeReferenceUrl(snapshot.url);
  if (!sourceUrl) return "";
  const coverUrl = safeReferenceAssetUrl(snapshot.cover);
  const source = snapshot.source || (() => {
    try { return new URL(sourceUrl).hostname; } catch { return "网页文章"; }
  })();
  const sourceLine = snapshot.author ? `${source} · ${snapshot.author}` : source;
  const cover = coverUrl
    ? `<img class="article-reference-cover" src="${escapeHtml(articleReferenceCoverSrc(coverUrl, sourceUrl))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span class="article-reference-cover article-reference-cover-fallback" aria-hidden="true">引</span>`;
  const date = snapshot.publishedAt
    ? `<time class="article-reference-date">${escapeHtml(snapshot.publishedAt)}</time>`
    : "";
  const hasSummary = Boolean(snapshot.summary || snapshot.keyPoints.length > 0);
  const summaryBody = hasSummary
    ? `<div class="article-reference-summary-body"><div class="article-reference-summary-inner">${snapshot.summary ? `<p>${escapeHtml(snapshot.summary)}</p>` : ""}${snapshot.keyPoints.length > 0 ? `<ul>${snapshot.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}</div></div>`
    : "";
  const actions = `<div class="article-reference-actions">${hasSummary ? `<span class="article-reference-summary-label">AI 摘要</span>` : ""}<a class="article-reference-read-original" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">阅读原文</a></div>`;
  const main = `<div class="article-reference-main">${cover}<div class="article-reference-copy"><p class="article-reference-source">${escapeHtml(sourceLine)}${date ? ` · ${date}` : ""}</p><h3 class="article-reference-title">${escapeHtml(snapshot.title)}</h3></div></div>`;

  if (hasSummary) {
    return `<details class="article-reference-card"><summary class="article-reference-card-summary">${main}${actions}</summary>${summaryBody}</details>`;
  }
  return `<aside class="article-reference-card" aria-label="引用文章">${main}${actions}</aside>`;
}
