import { marked, type Renderer, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import {
  articleReferenceCardHtml,
  decodeArticleReferencePayload,
  expandArticleReferenceMarkers,
  type ArticleReferenceSnapshot,
} from "@/lib/article-reference";
import { musicContainerHtml, parseMusicBlock } from "@/lib/music";
import { parseVideoBlock, videoContainerHtml } from "@/lib/video";

// 输出端白名单兜底：即使 renderer 层出现回归，也不放行任意标签/属性。
// 只保留文章实际用到的标签与属性；data-* 为 music 播放器容器所需。
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h2", "h3", "h4", "p", "br", "strong", "em", "del", "blockquote", "code", "pre",
    "ul", "ol", "li", "a", "img", "hr", "table", "thead", "tbody", "tr", "th", "td", "div", "span", "aside", "details", "summary", "time", "iframe",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel", "class"],
    img: ["src", "srcset", "sizes", "alt", "title", "loading", "decoding", "class", "data-original-src"],
    code: ["class"],
    div: ["class", "data-server", "data-id", "data-type", "data-shuffle", "data-music-name", "data-music-artist", "data-music-cover"],
    h3: ["class"],
    p: ["class"],
    ul: ["class"],
    li: ["class"],
    aside: ["class", "aria-label"],
    details: ["class", "open"],
    summary: ["class"],
    time: ["class", "datetime"],
    iframe: ["src", "title", "loading", "allow", "referrerpolicy", "allowfullscreen", "data-video-platform"],
    span: ["class", "aria-hidden"],
    th: ["align"],
    td: ["align"],
    "*": ["id"],
  },
};

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

/** HTML 属性转义，避免 Markdown 内容进入属性时破坏 HTML 结构。 */
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

/**
 * 只允许文章实际需要的链接协议。
 * marked 默认不会阻止 javascript:，因此这里必须在 renderer 层再次校验。
 */
function safeMarkdownUrl(value: string, kind: "link" | "image"): string | null {
  const url = value.trim();
  if (!url || /[\u0000-\u001f\u007f]/.test(url)) return null;
  if (url.startsWith("/") && !url.startsWith("//")) return url;
  if (url.startsWith("./") || url.startsWith("../") || url.startsWith("#")) return url;
  if (/^https?:\/\//i.test(url)) return url;
  if (kind === "link" && /^(?:mailto|tel):/i.test(url)) return url;
  return null;
}

const MARKDOWN_IMAGE_WIDTHS = [360, 480, 640, 750, 828, 1080, 1200, 1440, 1920];
const MARKDOWN_IMAGE_SIZES = "(max-width: 860px) calc(100vw - 2rem), 800px";

function nextImageUrl(src: string, width: number): string {
  const params = new URLSearchParams({ url: src, w: String(width), q: "72" });
  return `/image?${params.toString()}`;
}

function renderMarkdownImage(src: string, alt: string, titleAttribute: string): string {
  // 只优化本站上传图，外部图片不交给 Next Image，避免把未知域名变成开放代理。
  if (!src.startsWith("/uploads/")) {
    return `<img class="article-content-image site-image-loading" src="${escapeHtml(src)}" data-original-src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"${titleAttribute}>`;
  }
  const srcSet = MARKDOWN_IMAGE_WIDTHS
    .map((width) => `${nextImageUrl(src, width)} ${width}w`)
    .join(", ");
  return `<img class="article-content-image site-image-loading" src="${escapeHtml(nextImageUrl(src, 828))}" srcset="${escapeHtml(srcSet)}" sizes="${MARKDOWN_IMAGE_SIZES}" data-original-src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async"${titleAttribute}>`;
}

/**
 * 渲染文章 markdown 为 HTML。
 * h2/h3 会自动添加 id 属性用于 TOC 锚点。
 */
export function renderMarkdown(content: string, references: readonly ArticleReferenceSnapshot[] = []): string {
  const renderer = new marked.Renderer();
  let counter = 0;

  renderer.html = function (this: Renderer, { text }: Tokens.HTML | Tokens.Tag) {
    // 文章只允许 Markdown，不允许作者直接注入任意 HTML/脚本。
    return escapeHtml(text);
  };

  renderer.link = function (this: Renderer, { href, title, tokens }: Tokens.Link) {
    const safeHref = safeMarkdownUrl(href, "link");
    const label = this.parser.parseInline(tokens);
    if (!safeHref) return label;
    const external = /^https?:\/\//i.test(safeHref);
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    const externalAttributes = external ? ' target="_blank" rel="noopener noreferrer"' : "";
    return `<a href="${escapeHtml(safeHref)}"${titleAttribute}${externalAttributes}>${label}</a>`;
  };

  renderer.image = function (this: Renderer, { href, title, text }: Tokens.Image) {
    const safeSrc = safeMarkdownUrl(href, "image");
    if (!safeSrc) return escapeHtml(text);
    const titleAttribute = title ? ` title="${escapeHtml(title)}"` : "";
    return renderMarkdownImage(safeSrc, text, titleAttribute);
  };

  renderer.heading = function (this: Renderer, { tokens, depth }: Tokens.Heading) {
    const text = this.parser.parseInline(tokens);
    // 只有 h2/h3 参与自增编号，与 extractHeadings 的计数完全一致；
    // h1 不参与编号（目录不含 h1），避免含 # 一级标题的文章目录锚点错位。
    if (depth === 2 || depth === 3) {
      const id = `heading-${++counter}`;
      return `<h${depth} id="${id}">${text}</h${depth}>`;
    }
    return `<h${depth}>${text}</h${depth}>`;
  };

  // ```music 代码块：渲染为 QQ VIP 播放器容器，交由前端 MusicInitializer 初始化。
  // ```video 代码块：只渲染由 parseVideoBlock 校验过的 Bilibili/YouTube iframe。
  // !reference:... 会先展开成 reference 代码块，使用正文内置的元数据卡片；不会在前台请求第三方网页。
  // 非 music/video 语言走 marked 默认渲染，保持原有代码块样式不变。
  const defaultCode = renderer.code.bind(renderer);
  renderer.code = function (token: Tokens.Code) {
    const language = token.lang?.trim().toLowerCase() ?? "";
    if (language === "music" || language === "qqvip") {
      return parseMusicBlock(token.text)
        .map((spec) => musicContainerHtml(spec))
        .join("\n") || defaultCode(token);
    }
    if (language === "video") {
      return parseVideoBlock(token.text)
        .map((spec) => videoContainerHtml(spec))
        .join("\n");
    }
    if (language === "reference") {
      const snapshot = decodeArticleReferencePayload(token.text.trim(), references);
      return snapshot ? articleReferenceCardHtml(snapshot) : defaultCode(token);
    }
    return defaultCode(token);
  };

  const expandedContent = expandArticleReferenceMarkers(content);
  return sanitizeHtml(marked.parse(expandedContent, { async: false, gfm: true, breaks: false, renderer }), SANITIZE_OPTIONS);
}

/** 从 markdown 提取 h2/h3 标题列表，用于生成目录 */
export function extractHeadings(content: string): TocHeading[] {
  const headings: TocHeading[] = [];
  const regex = /^(#{2,3})\s+(.+)$/gm;
  let match;
  let idx = 0;
  while ((match = regex.exec(content)) !== null) {
    headings.push({
      id: `heading-${++idx}`,
      level: match[1].length,
      text: match[2].replace(/[*_`~\[\]]/g, ""),
    });
  }
  return headings;
}

/** 去掉 markdown 语法，生成纯文本摘要 */
export function stripMarkdown(content: string, maxLength = 100): string {
  let text = content
    .replace(/^[ \t]*!reference(?::|[ \t]+)\S+[ \t]*$/gm, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~]{1,3}([^*_~]*)[*_~]{1,3}/g, "$1")
    .replace(/[#>*_~|-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length > maxLength) text = text.slice(0, maxLength).trimEnd() + "…";
  return text;
}
