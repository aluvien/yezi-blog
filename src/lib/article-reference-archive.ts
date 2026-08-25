import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";
import { getArticleReferenceArchive, updateArticleReferenceSummary, upsertArticleReferenceArchive, upsertReferenceLibrarySnapshot, type ArticleReferenceArchive } from "@/lib/db";
import { analyzeReferenceReader, type ReferenceReaderBlock } from "@/lib/article-reference-ai";
import type { ArticleReferenceSnapshot } from "@/lib/article-reference";
import { getProjectRoot } from "@/lib/uploads";
import { fetchReferenceArchiveDocument, normalizeReferenceUrl } from "@/lib/article-reference-server";
import { detectSafeRasterImageMime } from "@/lib/image-signature";
import { assertPublicRemoteUrl } from "@/lib/remote-url";
import { safeRemoteFetch } from "@/lib/remote-fetch";
import { archiveReaderText as archiveText, referenceReaderHtmlToMarkdown } from "@/lib/article-reference-reader-markdown";

// 兼容既有后台阅读页与外部调用；实现已按职责移至独立的 Markdown 转换模块。
export { referenceReaderHtmlToMarkdown } from "@/lib/article-reference-reader-markdown";

const MAX_READER_HTML_LENGTH = 2 * 1024 * 1024;
const MAX_READER_TEXT_LENGTH = 200_000;
const ARCHIVE_DIRECTORY_NAME = "reference-archives";
const REFERENCE_IMAGE_DIRECTORY_NAME = "ref";
const MAX_REFERENCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_REFERENCE_IMAGES = 30;
const IMAGE_TIMEOUT_MS = 12_000;
const IMAGE_REDIRECT_LIMIT = 3;
const IMAGE_CACHE_CONCURRENCY = 3;
// 解析规则变化时必须提升版本，否则“更新正文”会因来源 HTML 未变化而复用旧缓存。
const REFERENCE_ARCHIVE_PIPELINE_VERSION = 5;

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface ArticleReferenceArchiveResult {
  archive: ArticleReferenceArchive;
  created: boolean;
  snapshot: ArticleReferenceSnapshot;
  cachedImages: number;
  aiApplied: boolean;
  summaryGenerated: boolean;
  report: ReferenceArchiveReport;
  unchanged: boolean;
  aiError?: string;
}

export interface ReferenceArchiveReport {
  candidateBlocks: number;
  keptBlocks: number;
  removedBlocks: number;
  ruleRemovedBlocks: number;
  aiRemovedBlocks: number;
  cachedImages: number;
  reusedImages: number;
  skippedImages: number;
  textCharacters: number;
  markdownBytes: number;
  quality: "good" | "review" | "poor";
}

type ReaderBlockRecord = ReferenceReaderBlock & { element: Element };

const BLOCK_SELECTOR = "h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,figure,table";
const HARD_NOISE_SELECTOR = [
  "nav", "footer", "form", "dialog", "noscript",
  "[role='navigation']", "[role='banner']", "[role='contentinfo']", "[role='complementary']",
  "[aria-hidden='true']", "[hidden]",
  "[class*='comment']", "[id*='comment']", "[class*='related']", "[id*='related']",
  "[class*='recommend']", "[id*='recommend']", "[class*='sidebar']", "[id*='sidebar']",
  "[class*='share']", "[id*='share']", "[class*='advert']", "[id*='advert']",
  "[class*='social']", "[class*='subscribe']", "[class*='breadcrumb']", "[class*='pagination']",
].join(",");
const NOISE_TEXT_PATTERN = /(?:往期精华|相关阅读|延伸阅读|推荐阅读|猜你喜欢|更多文章|点击关注|扫码关注|关注公众号|长按识别|免责声明|版权归原作者|点击下方|阅读原文|后台回复|留言评论|广告|赞赏支持|分享至|登录后评论|上一篇|下一篇)/i;
const QR_IMAGE_PATTERN = /(?:qrcode|qr-code|qr_code|weixin|wechat|reward|赞赏|二维码|公众号)/i;
const DIAGRAM_MARKER_PREFIX = "YEZI_REFERENCE_DIAGRAM_";

function archiveDirectory(): string {
  return path.join(getProjectRoot(), "data", ARCHIVE_DIRECTORY_NAME);
}

function referenceImageArchiveKey(canonicalUrl: string): string {
  return crypto.createHash("sha256").update(canonicalUrl).digest("hex");
}

function referenceImageDirectory(canonicalUrl: string): string {
  return path.join(getProjectRoot(), "data", REFERENCE_IMAGE_DIRECTORY_NAME, referenceImageArchiveKey(canonicalUrl));
}

function archiveRelativePath(canonicalUrl: string): string {
  const hash = crypto.createHash("sha256").update(canonicalUrl).digest("hex");
  return path.posix.join("data", ARCHIVE_DIRECTORY_NAME, `${hash}.html.gz`);
}

function absoluteArchivePath(relativePath: string): string | null {
  const root = archiveDirectory();
  const target = path.resolve(getProjectRoot(), relativePath);
  return target.startsWith(`${root}${path.sep}`) ? target : null;
}

function resolveReaderUrl(value: string | undefined, baseUrl: string): string {
  if (!value) return "";
  try {
    const url = new URL(value, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] || character);
}

function diagramLabel(value: string): string {
  return sanitizeHtml(value.replace(/<br\s*\/?\s*>/gi, "\n"), { allowedTags: [], allowedAttributes: {} })
    .replace(/\\([\[\]{}()])/g, "$1")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}

function wrapDiagramLabel(value: string, limit = 18): string[] {
  const lines: string[] = [];
  for (const source of value.split("\n")) {
    let remaining = source.trim();
    while (remaining.length > limit) {
      lines.push(remaining.slice(0, limit));
      remaining = remaining.slice(limit);
    }
    if (remaining) lines.push(remaining);
  }
  return lines.length > 0 ? lines.slice(0, 4) : [""];
}

/**
 * 归档不执行来源站脚本，因此 Mermaid 源码必须在服务端变成静态图。
 * 这里只支持阅读页最常见的 flowchart，生成的 SVG 不包含脚本或外部资源。
 */
function renderMermaidFlowchartSvg(source: string): string | null {
  type DiagramNode = { id: string; label: string; diamond: boolean };
  type DiagramEdge = { from: string; to: string; label: string };
  const nodes = new Map<string, DiagramNode>();
  const edges: DiagramEdge[] = [];
  const readNode = (value: string): DiagramNode | null => {
    const input = value.trim();
    const id = input.match(/^([A-Za-z][\w-]*)/)?.[1];
    if (!id) return null;
    const quoted = input.match(/^([A-Za-z][\w-]*)\s*\["([\s\S]*?)"\]/);
    const square = input.match(/^([A-Za-z][\w-]*)\s*\[([\s\S]*?)\]/);
    const diamond = input.match(/^([A-Za-z][\w-]*)\s*\{([\s\S]*?)\}/);
    const rounded = input.match(/^([A-Za-z][\w-]*)\s*\(([\s\S]*?)\)/);
    const rawLabel = quoted?.[2] ?? square?.[2] ?? diamond?.[2] ?? rounded?.[2] ?? id;
    const node = { id, label: diagramLabel(rawLabel) || id, diamond: Boolean(diamond) };
    const current = nodes.get(id);
    if (!current || current.label === id) nodes.set(id, node);
    return nodes.get(id)!;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^(?:graph|flowchart)\s+(?:TD|TB|LR|RL)$/i.test(line) || line.startsWith("%%")) continue;
    const arrow = line.indexOf("-->");
    if (arrow < 0) {
      readNode(line);
      continue;
    }
    const from = readNode(line.slice(0, arrow));
    let target = line.slice(arrow + 3).trim();
    let edgeLabel = "";
    const labelMatch = target.match(/^\|([^|]*)\|\s*/);
    if (labelMatch) {
      edgeLabel = diagramLabel(labelMatch[1]);
      target = target.slice(labelMatch[0].length);
    }
    const to = readNode(target);
    if (from && to) edges.push({ from: from.id, to: to.id, label: edgeLabel });
  }
  if (nodes.size === 0) return null;

  const level = new Map([...nodes.keys()].map((id) => [id, 0]));
  for (let pass = 0; pass < nodes.size; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = Math.min(nodes.size - 1, (level.get(edge.from) || 0) + 1);
      if (next > (level.get(edge.to) || 0)) {
        level.set(edge.to, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const groups = new Map<number, DiagramNode[]>();
  for (const node of nodes.values()) {
    const itemLevel = level.get(node.id) || 0;
    groups.set(itemLevel, [...(groups.get(itemLevel) || []), node]);
  }
  const levels = [...groups.keys()].sort((a, b) => a - b);
  const nodeWidth = 210;
  const nodeHeight = 70;
  const columnGap = 34;
  const rowGap = 72;
  const padding = 36;
  const maxColumns = Math.max(...[...groups.values()].map((items) => items.length));
  const width = Math.max(520, padding * 2 + maxColumns * nodeWidth + Math.max(0, maxColumns - 1) * columnGap);
  const height = padding * 2 + levels.length * nodeHeight + Math.max(0, levels.length - 1) * rowGap;
  const positions = new Map<string, { x: number; y: number }>();
  for (const [rowIndex, itemLevel] of levels.entries()) {
    const items = groups.get(itemLevel) || [];
    const rowWidth = items.length * nodeWidth + Math.max(0, items.length - 1) * columnGap;
    const startX = (width - rowWidth) / 2;
    items.forEach((node, columnIndex) => positions.set(node.id, { x: startX + columnIndex * (nodeWidth + columnGap), y: padding + rowIndex * (nodeHeight + rowGap) }));
  }
  const edgeSvg = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const x1 = from.x + nodeWidth / 2;
    const y1 = from.y + nodeHeight;
    const x2 = to.x + nodeWidth / 2;
    const y2 = to.y;
    const middle = (y1 + y2) / 2;
    const label = edge.label ? `<text x="${(x1 + x2) / 2}" y="${middle - 6}" text-anchor="middle" class="edge-label">${escapeXml(edge.label)}</text>` : "";
    return `<path d="M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}" class="edge" marker-end="url(#arrow)"/>${label}`;
  }).join("");
  const nodeSvg = [...nodes.values()].map((node) => {
    const position = positions.get(node.id)!;
    const lines = wrapDiagramLabel(node.label);
    const centerX = position.x + nodeWidth / 2;
    const textStart = position.y + nodeHeight / 2 - (lines.length - 1) * 10;
    const shape = node.diamond
      ? `<polygon points="${centerX},${position.y} ${position.x + nodeWidth},${position.y + nodeHeight / 2} ${centerX},${position.y + nodeHeight} ${position.x},${position.y + nodeHeight / 2}" class="node"/>`
      : `<rect x="${position.x}" y="${position.y}" width="${nodeWidth}" height="${nodeHeight}" rx="13" class="node"/>`;
    const text = lines.map((line, index) => `<text x="${centerX}" y="${textStart + index * 20}" text-anchor="middle" dominant-baseline="middle" class="node-label">${escapeXml(line)}</text>`).join("");
    return `${shape}${text}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="文章流程图"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#8a8a95"/></marker></defs><style>.node{fill:#f7f7f9;stroke:#c25f3d;stroke-width:1.5}.node-label{fill:#1a1a1f;font:14px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.edge{fill:none;stroke:#8a8a95;stroke-width:1.5}.edge-label{fill:#70747a;font:12px system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}</style>${edgeSvg}${nodeSvg}</svg>`;
}

function writeGeneratedDiagram(canonicalUrl: string, source: string): string | null {
  const svg = renderMermaidFlowchartSvg(source);
  if (!svg) return null;
  const fileName = `${crypto.createHash("sha256").update(`mermaid:${source}`).digest("hex")}.svg`;
  const directory = referenceImageDirectory(canonicalUrl);
  const target = path.join(directory, fileName);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (!fs.existsSync(target)) fs.writeFileSync(target, svg, { mode: 0o600 });
  return fileName;
}

function prepareReaderMedia(value: string, canonicalUrl: string): string {
  const { document } = parseReaderFragment(value);

  // 静态站点常在标题末尾放一个“#”锚点；它是页面控件，不属于标题正文。
  for (const heading of Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6"))) {
    for (const control of Array.from(heading.querySelectorAll("a[href^='#'],.anchor,.anchor-icon,[data-pagefind-ignore]"))) {
      const label = (control.textContent || "").replace(/\s+/g, "").trim();
      if (label === "#" || control.classList.contains("anchor") || control.classList.contains("anchor-icon")) control.remove();
    }
  }

  // Expressive Code 等高亮组件把每一行拆成“行号 + 代码”两个 div。
  // 直接读取 textContent 会得到 1#、2curl；这里按代码列重建纯文本代码块。
  for (const pre of Array.from(document.querySelectorAll("pre"))) {
    const renderedLines = Array.from(pre.querySelectorAll(".ec-line,[data-line],.code-line"));
    const code = pre.querySelector("code") || document.createElement("code");
    if (renderedLines.length > 0) {
      code.textContent = renderedLines.map((line) => {
        const explicitCode = line.querySelector(".code,.line-code,[data-code]");
        if (explicitCode) return explicitCode.textContent || "";
        const clone = line.cloneNode(true) as Element;
        for (const marker of Array.from(clone.querySelectorAll("[aria-hidden='true'],.gutter,.ln,.line-number,.line-numbers-rows"))) marker.remove();
        return clone.textContent || "";
      }).join("\n");
    } else {
      for (const lineNumber of Array.from(pre.querySelectorAll("[aria-hidden='true'],.gutter,.ln,.line-number,.line-numbers-rows"))) lineNumber.remove();
      code.textContent = code.textContent || pre.textContent || "";
    }
    const language = pre.getAttribute("data-language") || code.getAttribute("data-language") || "";
    if (/^[\w+-]+$/.test(language)) code.setAttribute("class", `language-${language}`);
    while (pre.firstChild) pre.firstChild.remove();
    pre.appendChild(code);
  }

  for (const image of Array.from(document.querySelectorAll("img"))) {
    const srcset = image.getAttribute("data-srcset") || image.getAttribute("srcset") || "";
    const srcsetUrl = srcset.split(",")[0]?.trim().split(/\s+/)[0] || "";
    const source = image.getAttribute("data-src") || image.getAttribute("data-original") || image.getAttribute("data-lazy-src")
      || image.getAttribute("data-actualsrc") || image.getAttribute("data-url") || image.getAttribute("src") || srcsetUrl;
    if (source) image.setAttribute("src", source);
  }
  for (const diagram of Array.from(document.querySelectorAll(".mermaid"))) {
    const source = diagram.textContent?.trim() || "";
    const fileName = source ? writeGeneratedDiagram(canonicalUrl, source) : null;
    if (!fileName) {
      diagram.remove();
      continue;
    }
    const marker = document.createElement("p");
    marker.textContent = `${DIAGRAM_MARKER_PREFIX}${fileName}`;
    diagram.replaceWith(marker);
  }
  return readerFragmentHtml(document, value);
}

function restoreGeneratedDiagrams(value: string, canonicalUrl: string): string {
  const { document } = parseReaderFragment(value);
  for (const paragraph of Array.from(document.querySelectorAll("p"))) {
    const text = (paragraph.textContent || "").trim();
    const fileName = text.startsWith(DIAGRAM_MARKER_PREFIX) ? text.slice(DIAGRAM_MARKER_PREFIX.length) : "";
    if (!/^[a-f0-9]{64}\.svg$/.test(fileName)) continue;
    const image = document.createElement("img");
    image.setAttribute("src", `/api/admin/article-references/archive-image/${referenceImageArchiveKey(canonicalUrl)}/${fileName}`);
    image.setAttribute("alt", "文章流程图");
    paragraph.replaceWith(image);
  }
  return readerFragmentHtml(document, value);
}

/**
 * 阅读快照里的外部正文图片也统一从本站受控代理读取：公众号图片若直接放进
 * 管理后台页面，通常会因 Referer 校验而显示防盗链占位图。
 */
function proxiedReaderImageUrl(value: string | undefined, baseUrl: string): string {
  const source = resolveReaderUrl(value, baseUrl);
  if (!source) return "";
  const params = new URLSearchParams({ url: source, referer: baseUrl });
  return `/api/article-references/image?${params.toString()}`;
}

/**
 * linkedom 的 parseHTML 会把“裸 HTML 片段”挂在 document 根节点，导致
 * document.body.innerHTML 为空。所有会修改阅读片段的操作都要先包成完整文档，
 * 再只取 body，避免图片替换或 AI 筛选后意外回退到修改前的原始片段。
 */
function parseReaderFragment(value: string) {
  return parseHTML(`<!doctype html><html><body>${value}</body></html>`);
}

function readerFragmentHtml(document: ReturnType<typeof parseHTML>["document"], fallback: string): string {
  return document.body?.innerHTML || fallback;
}

function elementText(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const image of Array.from(clone.querySelectorAll("img"))) image.remove();
  return (clone.textContent || "").replace(/\s+/g, " ").trim();
}

function blockType(element: Element): ReferenceReaderBlock["type"] {
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "blockquote") return "quote";
  if (tag === "pre") return "code";
  if (tag === "table") return "table";
  if (tag === "figure") return "caption";
  return "paragraph";
}

function topLevelReaderBlocks(document: ReturnType<typeof parseHTML>["document"]): ReaderBlockRecord[] {
  const elements = Array.from(document.body.querySelectorAll(BLOCK_SELECTOR));
  const topLevel = elements.filter((element) => !element.parentElement?.closest(BLOCK_SELECTOR));
  return topLevel.map((element, index) => ({
    id: index + 1,
    type: blockType(element),
    text: elementText(element),
    element,
  }));
}

function removeHardNoise(value: string): { html: string; removed: number } {
  const { document } = parseReaderFragment(value);
  let removed = 0;
  for (const node of Array.from(document.querySelectorAll(HARD_NOISE_SELECTOR))) {
    node.remove();
    removed += 1;
  }
  for (const image of Array.from(document.querySelectorAll("img"))) {
    const width = Number(image.getAttribute("width"));
    const height = Number(image.getAttribute("height"));
    const signature = [image.getAttribute("src"), image.getAttribute("alt"), image.getAttribute("class"), image.getAttribute("id")].filter(Boolean).join(" ");
    if ((width > 0 && height > 0 && width <= 8 && height <= 8) || QR_IMAGE_PATTERN.test(signature)) {
      const figure = image.closest("figure");
      if (figure && !elementText(figure)) figure.remove();
      else image.remove();
      removed += 1;
    }
  }
  const seen = new Set<string>();
  for (const block of topLevelReaderBlocks(document)) {
    const text = block.text;
    const onlyLinks = text.length > 0 && block.element.querySelectorAll("a").length > 0
      && text.length <= 120 && (block.element.textContent || "").trim() === text;
    const duplicateKey = text.length >= 24 ? text.toLocaleLowerCase() : "";
    const duplicate = Boolean(duplicateKey && seen.has(duplicateKey));
    if (duplicateKey) seen.add(duplicateKey);
    if ((!text && !block.element.querySelector("img")) || isClearlyNonContentBlock(text) || duplicate || onlyLinks && NOISE_TEXT_PATTERN.test(text)) {
      block.element.remove();
      removed += 1;
    }
  }
  return { html: readerFragmentHtml(document, value), removed };
}

/**
 * 视频文件和第三方播放器不进入本地归档：它们通常很大、需要短期授权或带有脚本。
 * 阅读快照保留一个回到来源页的明确入口，正文仍然完整可读且不会出现失效播放器。
 */
function replaceEmbeddedVideosWithReaderLinks(value: string, articleUrl: string): string {
  const { document } = parseReaderFragment(value);
  const embedded = Array.from(document.querySelectorAll("video,iframe,embed,object"));
  for (const node of embedded) {
    const paragraph = document.createElement("p");
    const link = document.createElement("a");
    link.setAttribute("href", articleUrl);
    link.setAttribute("title", "在原文中观看视频");
    link.textContent = "视频内容请在原文观看 ↗";
    paragraph.appendChild(link);
    node.replaceWith(paragraph);
  }
  return readerFragmentHtml(document, value);
}

function cleanReaderHtml(value: string, baseUrl: string): string {
  const cleaned = sanitizeHtml(value, {
    allowedTags: [
      "article", "section", "header", "blockquote", "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "b", "em", "i", "u", "s", "del", "code", "pre", "kbd", "mark", "sub", "sup",
      "ul", "ol", "li", "dl", "dt", "dd", "figure", "figcaption", "img", "a", "table", "thead", "tbody",
      "tr", "th", "td", "caption", "span", "div",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      img: ["src", "alt", "width", "height"],
      code: ["class"],
      ol: ["start"],
      li: ["value"],
      th: ["colspan", "rowspan"],
      td: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https"],
    disallowedTagsMode: "discard",
    transformTags: {
      a: (_tagName, attribs) => {
        const href = resolveReaderUrl(attribs.href, baseUrl);
        const safeAttributes: Record<string, string> = {};
        if (href) {
          safeAttributes.href = href;
          if (attribs.title) safeAttributes.title = attribs.title;
        }
        return { tagName: "a", attribs: safeAttributes };
      },
      img: (_tagName, attribs) => {
        const src = resolveReaderUrl(attribs.src || attribs["data-src"] || attribs["data-original"], baseUrl);
        const safeAttributes: Record<string, string> = {};
        if (src) {
          safeAttributes.src = src;
          if (attribs.alt) safeAttributes.alt = attribs.alt;
        }
        return { tagName: "img", attribs: safeAttributes };
      },
    },
    exclusiveFilter(frame) {
      return (frame.tag === "a" || frame.tag === "img") && Object.keys(frame.attribs).length === 0;
    },
  });
  // 保护 SQLite 和服务端渲染，避免单篇异常页面形成超大的阅读快照。
  return cleaned.slice(0, MAX_READER_HTML_LENGTH);
}

function proxifyReaderImages(value: string, baseUrl: string): string {
  const { document } = parseReaderFragment(value);
  for (const image of Array.from(document.querySelectorAll("img"))) {
    const source = resolveReaderUrl(image.getAttribute("src") || "", baseUrl);
    if (source) image.setAttribute("src", proxiedReaderImageUrl(source, baseUrl));
  }
  return readerFragmentHtml(document, value);
}

function cacheImageResponseType(contentType: string): string {
  return contentType.split(";", 1)[0].trim().toLowerCase();
}

async function readLimitedImage(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REFERENCE_IMAGE_BYTES) throw new Error("图片过大");
  if (!response.body) {
    const value = new Uint8Array(await response.arrayBuffer());
    if (value.byteLength > MAX_REFERENCE_IMAGE_BYTES) throw new Error("图片过大");
    return value;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_REFERENCE_IMAGE_BYTES - size;
      if (remaining <= 0 || value.byteLength > remaining) {
        await reader.cancel();
        throw new Error("图片过大");
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

async function downloadReferenceImage(input: string, referer: string): Promise<{ bytes: Uint8Array; contentType: string }> {
  let current = normalizeReferenceUrl(input);
  for (let redirect = 0; redirect <= IMAGE_REDIRECT_LIMIT; redirect += 1) {
    current = await assertPublicRemoteUrl(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
    try {
      const response = await safeRemoteFetch(current, {
        signal: controller.signal,
        headers: {
          accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
          referer,
          "user-agent": "Mozilla/5.0 (compatible; YeziBlogReference/1.0; +https://yezi.me)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location || redirect === IMAGE_REDIRECT_LIMIT) throw new Error("图片跳转次数过多");
        current = normalizeReferenceUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`图片返回 ${response.status}`);
      const declaredType = cacheImageResponseType(response.headers.get("content-type") || "");
      if (declaredType === "image/svg+xml") throw new Error("SVG 图片不进入远程缓存");
      const bytes = await readLimitedImage(response);
      const contentType = detectSafeRasterImageMime(bytes);
      if (!contentType || !IMAGE_EXTENSIONS[contentType]) throw new Error("图片内容或格式不支持缓存");
      return { bytes, contentType };
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) throw new Error("图片读取超时");
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("图片读取失败");
}

function writeReferenceImage(canonicalUrl: string, sourceUrl: string, bytes: Uint8Array, contentType: string): string {
  const extension = IMAGE_EXTENSIONS[contentType];
  const fileName = `${crypto.createHash("sha256").update(sourceUrl).digest("hex")}.${extension}`;
  const directory = referenceImageDirectory(canonicalUrl);
  const target = path.join(directory, fileName);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, bytes, { mode: 0o600 });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
  return fileName;
}

async function cacheReaderImages(value: string, canonicalUrl: string, referer: string): Promise<{ html: string; count: number; reused: number; skipped: number }> {
  const { document } = parseReaderFragment(value);
  const images = Array.from(document.querySelectorAll("img")).slice(0, MAX_REFERENCE_IMAGES);
  const replacements = new Map<string, string>();
  const isLocalArchiveImage = (source: string) => source.startsWith(`/api/admin/article-references/archive-image/${referenceImageArchiveKey(canonicalUrl)}/`);
  const localImages = images.filter((image) => isLocalArchiveImage(image.getAttribute("src") || ""));
  const sources = [...new Set(images
    .map((image) => image.getAttribute("src") || "")
    .filter((source) => !isLocalArchiveImage(source))
    .map((source) => resolveReaderUrl(source, referer))
    .filter(Boolean))];
  let count = 0;
  let reused = localImages.length;
  let skipped = Math.max(0, document.querySelectorAll("img").length - images.length);

  // 图片逐张下载会让 30 张都超时时长累积到 6 分钟。限制为 3 路并发，
  // 既不对来源站点造成突刺，也能把最坏等待压缩到可控范围。
  let cursor = 0;
  async function cacheNextImage(): Promise<void> {
    while (cursor < sources.length) {
      const source = sources[cursor];
      cursor += 1;
      try {
        const sourceHash = crypto.createHash("sha256").update(source).digest("hex");
        const directory = referenceImageDirectory(canonicalUrl);
        const existing = fs.existsSync(directory)
          ? fs.readdirSync(directory).find((fileName) => new RegExp(`^${sourceHash}\\.(?:avif|gif|jpe?g|png|webp)$`).test(fileName))
          : undefined;
        if (existing) {
          replacements.set(source, `/api/admin/article-references/archive-image/${referenceImageArchiveKey(canonicalUrl)}/${existing}`);
          reused += 1;
          continue;
        }
        const downloaded = await downloadReferenceImage(source, referer);
        const fileName = writeReferenceImage(canonicalUrl, source, downloaded.bytes, downloaded.contentType);
        replacements.set(source, `/api/admin/article-references/archive-image/${referenceImageArchiveKey(canonicalUrl)}/${fileName}`);
        count += 1;
      } catch {
        // 单张图片失败不能使整篇归档失败；仍走本站代理以规避大多数防盗链。
        replacements.set(source, proxiedReaderImageUrl(source, referer));
        skipped += 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(IMAGE_CACHE_CONCURRENCY, sources.length) }, () => cacheNextImage()));

  for (const image of images) {
    const rawSource = image.getAttribute("src") || "";
    if (isLocalArchiveImage(rawSource)) continue;
    const source = resolveReaderUrl(rawSource, referer);
    if (!source) continue;
    const localUrl = replacements.get(source);
    if (localUrl) image.setAttribute("src", localUrl);
  }
  const usedFiles = new Set([
    ...replacements.values(),
    ...localImages.map((image) => image.getAttribute("src") || ""),
  ].map((url) => url.split("/").pop() || "").filter(Boolean));
  const directory = referenceImageDirectory(canonicalUrl);
  if (fs.existsSync(directory)) {
    for (const fileName of fs.readdirSync(directory)) {
      if (/^[a-f0-9]{64}\.(?:avif|gif|jpe?g|png|webp|svg)$/.test(fileName) && !usedFiles.has(fileName)) fs.rmSync(path.join(directory, fileName), { force: true });
    }
  }
  return { html: readerFragmentHtml(document, value), count, reused, skipped };
}

/** 解析私有归档图片，不接受任意路径或目录跳转。 */
export function getCachedReferenceImagePath(key: string, fileName: string): string | null {
  if (!/^[a-f0-9]{64}$/.test(key) || !/^[a-f0-9]{64}\.(?:avif|gif|jpe?g|png|webp|svg)$/.test(fileName)) return null;
  const root = path.join(getProjectRoot(), "data", REFERENCE_IMAGE_DIRECTORY_NAME);
  const target = path.resolve(root, key, fileName);
  return target.startsWith(`${root}${path.sep}`) && fs.existsSync(target) ? target : null;
}

function preferredArticleContent(html: string): string {
  const { document } = parseHTML(html);
  // 微信及常见 CMS 的正文容器比通用算法更可靠；优先取这些节点，避免
  // Readability 在过于简单、脚本较多的页面里把正文误判为空。
  const selectors = [
    "#js_content", "#rich_media_content", "[itemprop='articleBody']", "article",
    "main article", "main", ".article-content", ".article-body", ".post-content", ".entry-content",
    ".rich_media_content", ".content-article", ".article-detail",
  ];
  const candidates = selectors
    .map((selector) => document.querySelector(selector))
    .filter((node): node is Element => Boolean(node))
    .map((node, index) => {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      const paragraphs = node.querySelectorAll("p,li,blockquote,pre,tr").length;
      const links = Array.from(node.querySelectorAll("a")).reduce((sum, link) => sum + (link.textContent || "").trim().length, 0);
      const linkRatio = text.length > 0 ? links / text.length : 1;
      const structure = node.querySelectorAll("h1,h2,h3,h4,h5,h6,p,ul,ol,blockquote,pre,table,img").length;
      const priority = index < 3 ? 2_000 : 0;
      return { html: node.innerHTML || "", length: text.length, score: priority + text.length + paragraphs * 28 + structure * 12 - linkRatio * 2_000 };
    })
    .filter((candidate) => candidate.html && candidate.length > 0);
  const preferred = candidates.sort((a, b) => b.score - a.score)[0];
  return preferred?.html || "";
}

function fallbackReaderHtml(text: string): string {
  const escaped = text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
  return escaped ? `<p>${escaped}</p>` : "";
}

function extractReaderSnapshot(html: string, baseUrl: string, fallbackText: string, canonicalUrl: string): { html: string; text: string } {
  try {
    const preferred = preferredArticleContent(html);
    if (preferred) {
      const prepared = prepareReaderMedia(replaceEmbeddedVideosWithReaderLinks(preferred, baseUrl), canonicalUrl);
      const readerHtml = restoreGeneratedDiagrams(cleanReaderHtml(prepared, baseUrl), canonicalUrl);
      const text = archiveText(readerHtml);
      if (readerHtml && text) return { html: readerHtml, text };
    }
    // Readability 会移除站点导航、推荐、广告等非正文节点；随后仍经过服务端白名单清洗。
    const { document } = parseHTML(html);
    const article = new Readability(document as unknown as Document, {
      charThreshold: 80,
      keepClasses: false,
      nbTopCandidates: 8,
    }).parse();
    const content = article?.content || fallbackReaderHtml(fallbackText);
    const prepared = prepareReaderMedia(replaceEmbeddedVideosWithReaderLinks(content, baseUrl), canonicalUrl);
    const readerHtml = restoreGeneratedDiagrams(cleanReaderHtml(prepared, baseUrl), canonicalUrl) || fallbackReaderHtml(fallbackText);
    return { html: readerHtml, text: archiveText(readerHtml) || fallbackText.slice(0, MAX_READER_TEXT_LENGTH) };
  } catch {
    const readerHtml = cleanReaderHtml(fallbackReaderHtml(fallbackText), baseUrl);
    return { html: readerHtml, text: archiveText(readerHtml) };
  }
}

function readerBlocks(value: string): ReferenceReaderBlock[] {
  const { document } = parseReaderFragment(value);
  for (const image of Array.from(document.querySelectorAll("img"))) image.remove();
  const blocks = topLevelReaderBlocks(document).filter((block) => block.text).map(({ id, type, text }) => ({ id, type, text }));
  return blocks.length > 0 ? blocks : [{ id: 1, type: "paragraph", text: archiveText(value) }].filter((block) => block.text.length > 0) as ReferenceReaderBlock[];
}

function filterReaderHtmlByAi(value: string, keepBlockIds: number[], evaluatedBlockIds: number[]): { html: string; removed: number } {
  if (keepBlockIds.length === 0) return { html: value, removed: 0 };
  const keep = new Set(keepBlockIds);
  const evaluated = new Set(evaluatedBlockIds);
  const { document } = parseReaderFragment(value);
  let removed = 0;
  for (const block of topLevelReaderBlocks(document)) {
    if (!block.text || !evaluated.has(block.id) || keep.has(block.id)) continue;
    if (block.element.querySelector("img") && !NOISE_TEXT_PATTERN.test(block.text)) continue;
    block.element.remove();
    removed += 1;
  }
  return { html: readerFragmentHtml(document, value), removed };
}

/**
 * 公众号常把“往期导读”等内容放在 -END- 后。它不是正文的一部分，不能只依赖
 * 模型判断；遇到文章结束标记后直接删除标记本身及其后的所有节点，规则确定可复现。
 */
function truncateReaderAfterEndMarker(value: string): string {
  const { document } = parseReaderFragment(value);
  const isEndMarker = (node: Element) => /(?:^|\s)-?END-?(?:\s|$)/i.test((node.textContent || "").replace(/\s+/g, " ").trim());
  const isTailStart = (node: Element) => /(往期精华|相关阅读|延伸阅读|推荐阅读|点击关注|扫码关注|关注公众号|长按识别|免责声明|版权归原作者)/.test((node.textContent || "").replace(/\s+/g, " ").trim());
  // 优先找最小的文本块，避免 section/div 在文档顺序中早于其内部的 -END- 段落。
  const blockSelector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figure,table";
  const marker = Array.from(document.querySelectorAll(blockSelector)).find(isTailStart)
    ?? Array.from(document.querySelectorAll("section,div")).find(isTailStart)
    ?? Array.from(document.querySelectorAll(blockSelector)).find(isEndMarker)
    ?? Array.from(document.querySelectorAll("section,div")).find(isEndMarker);
  if (!marker) return value;

  // 标记常在深层 span 内，先删除包含它的最小“正文块”，再删掉它之后的所有同级节点。
  let block: Element = marker;
  while (block.parentElement && block.parentElement !== document.body && block.parentElement.childElementCount === 1) {
    block = block.parentElement;
  }
  let current: Element | null = block;
  while (current) {
    const sibling: Element | null = current.nextElementSibling;
    current.remove();
    current = sibling;
  }
  return readerFragmentHtml(document, value);
}

function isClearlyNonContentBlock(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^[—\-_=－]{5,}$/.test(text)) return true;
  if (/^(?:-?END-?|全文完|完)$/i.test(text)) return true;
  return NOISE_TEXT_PATTERN.test(text);
}

function writeRawSnapshot(canonicalUrl: string, html: string): string {
  const relativePath = archiveRelativePath(canonicalUrl);
  const target = absoluteArchivePath(relativePath);
  if (!target) throw new Error("归档路径无效");
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(temporary, gzipSync(Buffer.from(html, "utf8"), { level: 9 }), { mode: 0o600 });
    fs.renameSync(temporary, target);
    fs.chmodSync(target, 0o600);
  } finally {
    if (fs.existsSync(temporary)) fs.rmSync(temporary, { force: true });
  }
  return relativePath;
}

/** 抓取一次第三方页面，保存原始压缩快照及经阅读模式提取、净化后的私有正文。 */
export async function captureArticleReferenceArchive(input: string, options: { cacheImages?: boolean } = {}): Promise<ArticleReferenceArchiveResult> {
  const normalizedUrl = normalizeReferenceUrl(input);
  const before = getArticleReferenceArchive(normalizedUrl);
  const document = await fetchReferenceArchiveDocument(normalizedUrl);
  const canonicalUrl = document.snapshot.canonicalUrl || document.snapshot.url;
  const reader = extractReaderSnapshot(document.html, document.finalUrl, document.text, canonicalUrl);
  if (!reader.html || !reader.text) throw new Error("未能提取可阅读的文章正文");

  const endTrimmedHtml = truncateReaderAfterEndMarker(reader.html);
  const candidateBlocks = readerBlocks(endTrimmedHtml).length;
  const ruleCleaned = removeHardNoise(endTrimmedHtml);
  const cleanedBlocks = readerBlocks(ruleCleaned.html);
  const contentHash = crypto.createHash("sha256")
    .update(`reader-pipeline:${REFERENCE_ARCHIVE_PIPELINE_VERSION}\n${ruleCleaned.html}`)
    .digest("hex");
  if (before?.content_hash === contentHash && before.reader_markdown) {
    const report = parseArchiveReport(before.cache_report);
    upsertReferenceLibrarySnapshot({ ...document.snapshot, canonicalUrl });
    return {
      archive: before,
      created: false,
      snapshot: document.snapshot,
      cachedImages: report.cachedImages + report.reusedImages,
      aiApplied: false,
      summaryGenerated: false,
      report,
      unchanged: true,
    };
  }
  const analysis = await analyzeReferenceReader({
    title: document.snapshot.title,
    source: document.snapshot.source,
    blocks: cleanedBlocks,
  });
  const aiFiltered = analysis.applied
    ? filterReaderHtmlByAi(ruleCleaned.html, analysis.keepBlockIds, analysis.evaluatedBlockIds)
    : { html: ruleCleaned.html, removed: 0 };
  const images = options.cacheImages === false
    ? { html: proxifyReaderImages(aiFiltered.html, document.finalUrl), count: 0, reused: 0, skipped: 0 }
    : await cacheReaderImages(aiFiltered.html, canonicalUrl, document.finalUrl);
  const rawPath = writeRawSnapshot(canonicalUrl, document.html);
  const readerMarkdown = referenceReaderHtmlToMarkdown(images.html);
  const readerText = archiveText(images.html);
  const keptBlocks = readerBlocks(aiFiltered.html).length;
  const report: ReferenceArchiveReport = {
    candidateBlocks,
    keptBlocks,
    removedBlocks: Math.max(0, candidateBlocks - keptBlocks),
    ruleRemovedBlocks: Math.max(0, candidateBlocks - cleanedBlocks.length),
    aiRemovedBlocks: aiFiltered.removed,
    cachedImages: images.count,
    reusedImages: images.reused,
    skippedImages: images.skipped,
    textCharacters: readerText.length,
    markdownBytes: Buffer.byteLength(readerMarkdown, "utf8"),
    quality: readerText.length < 180 || keptBlocks < 2 ? "poor" : readerText.length < 600 || keptBlocks < 4 ? "review" : "good",
  };
  const archive = upsertArticleReferenceArchive({
    canonical_url: canonicalUrl,
    url: document.snapshot.url,
    title: document.snapshot.title,
    source_name: document.snapshot.source,
    author: document.snapshot.author,
    published_at: document.snapshot.publishedAt,
    reader_html: images.html,
    reader_markdown: readerMarkdown,
    reader_text: readerText,
    summary: analysis.summary || before?.summary || "",
    key_points: analysis.keyPoints.length > 0 ? JSON.stringify(analysis.keyPoints) : before?.key_points || "[]",
    ai_cleaned_at: analysis.applied ? new Date().toISOString() : "",
    raw_path: rawPath,
    content_hash: contentHash,
    cache_report: JSON.stringify(report),
  });
  // 仅在模型确实给出了摘要时覆盖卡片，避免临时的 LLM 异常清空已有公开摘要。
  const summaryGenerated = Boolean(analysis.summary || analysis.keyPoints.length > 0);
  if (summaryGenerated) updateArticleReferenceSummary(canonicalUrl, analysis.summary, analysis.keyPoints);
  // 归档可以从后台资料库直接触发，因此也同步更新独立资料库的元信息。
  upsertReferenceLibrarySnapshot({
    ...document.snapshot,
    canonicalUrl,
    summary: summaryGenerated ? analysis.summary : document.snapshot.summary,
    keyPoints: summaryGenerated ? analysis.keyPoints : document.snapshot.keyPoints,
  });
  return {
    archive,
    created: !before,
    snapshot: document.snapshot,
    cachedImages: images.count + images.reused,
    aiApplied: analysis.applied,
    summaryGenerated,
    report,
    unchanged: false,
    aiError: analysis.error,
  };
}

export function parseArchiveReport(value: string | null | undefined): ReferenceArchiveReport {
  try {
    const parsed = JSON.parse(value || "{}") as Partial<ReferenceArchiveReport>;
    return {
      candidateBlocks: Number(parsed.candidateBlocks) || 0,
      keptBlocks: Number(parsed.keptBlocks) || 0,
      removedBlocks: Number(parsed.removedBlocks) || 0,
      ruleRemovedBlocks: Number(parsed.ruleRemovedBlocks) || 0,
      aiRemovedBlocks: Number(parsed.aiRemovedBlocks) || 0,
      cachedImages: Number(parsed.cachedImages) || 0,
      reusedImages: Number(parsed.reusedImages) || 0,
      skippedImages: Number(parsed.skippedImages) || 0,
      textCharacters: Number(parsed.textCharacters) || 0,
      markdownBytes: Number(parsed.markdownBytes) || 0,
      quality: parsed.quality === "good" || parsed.quality === "poor" ? parsed.quality : "review",
    };
  } catch {
    return { candidateBlocks: 0, keptBlocks: 0, removedBlocks: 0, ruleRemovedBlocks: 0, aiRemovedBlocks: 0, cachedImages: 0, reusedImages: 0, skippedImages: 0, textCharacters: 0, markdownBytes: 0, quality: "review" };
  }
}

/** 原始 HTML 永远不经公开路径暴露；管理员下载时才从此私有目录读取。 */
export function readArticleReferenceRawArchive(archive: ArticleReferenceArchive): Buffer | null {
  const target = absoluteArchivePath(archive.raw_path);
  if (!target || !fs.existsSync(target)) return null;
  try {
    return gunzipSync(fs.readFileSync(target));
  } catch {
    return null;
  }
}
