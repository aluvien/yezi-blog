/**
 * 文章引用的共享格式。
 *
 * 引用快照直接写进 Markdown 标记，而不是让前台渲染时再次请求第三方网页。
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

const MAX_TITLE_LENGTH = 240;
const MAX_SOURCE_LENGTH = 100;
const MAX_AUTHOR_LENGTH = 100;
const MAX_DATE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 500;
const MAX_SUMMARY_LENGTH = 800;
const MAX_POINT_LENGTH = 180;
const MAX_POINTS = 6;

function text(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
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
    publishedAt: text(input.publishedAt, MAX_DATE_LENGTH),
    cover: normalizeAssetUrl(input.cover),
    description: text(input.description, MAX_DESCRIPTION_LENGTH),
    summary: text(input.summary, MAX_SUMMARY_LENGTH),
    keyPoints: points,
  };
}

export function encodeArticleReferenceMarker(input: Partial<ArticleReferenceSnapshot>): string {
  const snapshot = normalizeArticleReferenceSnapshot(input);
  return `!reference:${encodeURIComponent(JSON.stringify(snapshot))}`;
}

export function decodeArticleReferencePayload(payload: string): ArticleReferenceSnapshot | null {
  try {
    const parsed = JSON.parse(decodeURIComponent(payload)) as Partial<ArticleReferenceSnapshot>;
    const snapshot = normalizeArticleReferenceSnapshot(parsed);
    return snapshot.url ? snapshot : null;
  } catch {
    return null;
  }
}

function referenceMarkerRegex(): RegExp {
  // 每次都创建新实例，避免 matchAll/replace 的 lastIndex 影响后续渲染。
  return /^\s*!reference(?::|\s+)(\S+)\s*$/gm;
}

/** 读取文章正文里已经插入的引用快照，供保存时写入 SQLite 缓存。 */
export function parseArticleReferenceMarkers(content: string): ArticleReferenceSnapshot[] {
  const references: ArticleReferenceSnapshot[] = [];
  for (const match of content.matchAll(referenceMarkerRegex())) {
    const snapshot = decodeArticleReferencePayload(match[1]);
    if (snapshot) references.push(snapshot);
  }
  return references;
}

/** 把编辑器里的短标记转成 marked 可识别的自定义代码块。 */
export function expandArticleReferenceMarkers(content: string): string {
  return content.replace(referenceMarkerRegex(), (_line, payload: string) => {
    return `\n\`\`\`reference\n${payload}\n\`\`\`\n`;
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
    ? `<img class="article-reference-cover" src="${escapeHtml(coverUrl)}" alt="" loading="lazy" decoding="async">`
    : `<span class="article-reference-cover article-reference-cover-fallback" aria-hidden="true">引</span>`;
  const description = snapshot.description
    ? `<p class="article-reference-description">${escapeHtml(snapshot.description)}</p>`
    : "";
  const date = snapshot.publishedAt
    ? `<time class="article-reference-date">${escapeHtml(snapshot.publishedAt)}</time>`
    : "";
  const summary = snapshot.summary || snapshot.keyPoints.length > 0
    ? `<details class="article-reference-summary"><summary>AI 摘要</summary><div class="article-reference-summary-body">${snapshot.summary ? `<p>${escapeHtml(snapshot.summary)}</p>` : ""}${snapshot.keyPoints.length > 0 ? `<ul>${snapshot.keyPoints.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>` : ""}</div></details>`
    : "";

  return `<aside class="article-reference-card" aria-label="引用文章"><div class="article-reference-main">${cover}<div class="article-reference-copy"><p class="article-reference-source">${escapeHtml(sourceLine)}${date ? ` · ${date}` : ""}</p><h3 class="article-reference-title"><a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(snapshot.title)}</a></h3>${description}</div></div>${summary}<a class="article-reference-original" href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a></aside>`;
}
