import { marked, type Renderer, type Tokens } from "marked";
import sanitizeHtml from "sanitize-html";
import {
  articleReferenceCardHtml,
  decodeArticleReferencePayload,
  expandArticleReferenceMarkers,
  type ArticleReferenceSnapshot,
} from "@/lib/article-reference";
import { musicContainerHtml, parseMusicBlock, parseMusicSpec } from "@/lib/music";
import { parseVideoBlock, videoContainerHtml } from "@/lib/video";
import { expandMediaShortcodes } from "@/lib/media-shortcodes";

// 输出端白名单兜底：即使 renderer 层出现回归，也不放行任意标签/属性。
// 只保留文章实际用到的标签与属性；data-* 为 music 播放器容器所需。
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "h1", "h2", "h3", "h4", "h5", "h6", "p", "br", "strong", "em", "del", "blockquote", "cite", "code", "pre",
    "ul", "ol", "li", "a", "img", "hr", "table", "thead", "tbody", "tr", "th", "td", "div", "span", "aside", "details", "summary", "time", "iframe", "button", "svg", "path", "rect",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel", "class"],
    img: ["src", "srcset", "sizes", "alt", "title", "loading", "decoding", "class", "data-original-src"],
    code: ["class"],
    blockquote: ["class"],
    div: ["class", "data-hydrated", "data-server", "data-id", "data-type", "data-shuffle", "data-music-name", "data-music-artist", "data-music-cover", "data-lang", "data-lines"],
    h3: ["class"],
    p: ["class", "data-icon"],
    ul: ["class"],
    li: ["class"],
    aside: ["class", "aria-label"],
    details: ["class", "open"],
    summary: ["class"],
    time: ["class", "datetime"],
    iframe: ["src", "title", "loading", "allow", "referrerpolicy", "allowfullscreen", "data-video-platform"],
    span: ["class", "aria-hidden"],
    button: ["class", "type", "aria-label", "title", "data-state", "data-code-copy"],
    svg: ["class", "width", "height", "viewBox", "fill", "stroke", "stroke-width", "aria-hidden"],
    path: ["d", "fill", "stroke", "stroke-width"],
    rect: ["x", "y", "width", "height", "rx", "fill", "stroke", "stroke-width"],
    cite: [],
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
 * 文章和想法共用独占行短代码。文章继续兼容旧的 fenced code block：
 *
 *   !music qqvip:002eDlpu4U223F:song
 *   !video https://www.bilibili.com/video/BV13JMi6yE4p
 */
function renderEmbedShortcode(text: string): string | null {
  const match = text.trim().match(/^!(music|video)\s+(.+?)\s*$/i);
  if (!match) return null;

  if (match[1].toLowerCase() === "music") {
    const spec = parseMusicSpec(match[2]);
    return spec ? musicContainerHtml(spec) : null;
  }

  const spec = parseVideoBlock(match[2])[0];
  return spec ? videoContainerHtml(spec) : null;
}

/**
 * 将 Whono 兼容的容器语法转换为安全 HTML。
 *
 *   :::note[标题]
 *   正文
 *   :::
 *
 * Callout 的正文继续走完整 Markdown 渲染链，因而不会因为支持该语法而放开
 * 原始 HTML。pullquote 是目标主题提供的引用变体，也用同一套围栏语法兼容。
 */
function expandCalloutDirectives(
  content: string,
  references: readonly ArticleReferenceSnapshot[],
  blocks: Map<string, string>,
): string {
  const directivePattern = /^:::(note|tip|info|warning|pullquote)(?:\[([^\]\r\n]*)\])?[ \t]*\r?\n([\s\S]*?)^[ \t]*:::[ \t]*$/gim;
  return content.replace(directivePattern, (_match, rawType: string, rawTitle: string | undefined, rawBody: string) => {
    const type = rawType.toLowerCase();
    const body = renderMarkdown(rawBody.trim(), references);
    const token = `__YEZI_CALLOUT_${blocks.size}__`;
    if (type === "pullquote") {
      // 原始 HTML 默认会被转义；pullquote 只恢复无属性的 cite 标记，保留
      // 引用来源的目标主题排版，同时不会放开任意 HTML。
      const pullquoteBody = body.replace(/&lt;cite&gt;([\s\S]*?)&lt;\/cite&gt;/gi, "<cite>$1</cite>");
      blocks.set(token, `<blockquote class="pullquote">${pullquoteBody}</blockquote>`);
      return `\n${token}\n`;
    }
    const title = rawTitle?.trim();
    const titleHtml = title ? `<p class="callout-title">${escapeHtml(title)}</p>` : "";
    blocks.set(token, `<div class="callout ${type}">${titleHtml}${body}</div>`);
    return `\n${token}\n`;
  });
}

/** 保留目标主题文档中允许的两种 Callout HTML 写法，其余原始 HTML 仍会转义。 */
function expandSafeCalloutHtml(content: string, blocks: Map<string, string>): string {
  const htmlPattern = /<div\s+class=["']callout\s+(?:note|tip|info|warning)["'][^>]*>[\s\S]*?<\/div>|<blockquote\s+class=["']pullquote["'][^>]*>[\s\S]*?<\/blockquote>/gi;
  return content.replace(htmlPattern, (rawHtml: string) => {
    const token = `__YEZI_CALLOUT_${blocks.size}__`;
    blocks.set(token, sanitizeHtml(rawHtml, SANITIZE_OPTIONS));
    return `\n${token}\n`;
  });
}

/**
 * 渲染文章 markdown 为 HTML。
 * h2/h3 会自动添加 id 属性用于 TOC 锚点。
 */
export function renderMarkdown(content: string, references: readonly ArticleReferenceSnapshot[] = []): string {
  const renderer = new marked.Renderer();
  const specialBlocks = new Map<string, string>();
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
  // 非 music/video 语言使用与目标主题一致的代码容器：顶部语言/编码信息、
  // 行号以及复制按钮。代码文本本身仍由 escapeHtml 处理，不打开任意 HTML。
  const defaultCode = renderer.code.bind(renderer);
  const defaultParagraph = renderer.paragraph.bind(renderer);
  renderer.paragraph = function (token: Tokens.Paragraph) {
    const specialBlock = specialBlocks.get(token.text.trim());
    if (specialBlock) return specialBlock;
    return renderEmbedShortcode(token.text) ?? defaultParagraph(token);
  };
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
    const languageLabel = language ? ({
      js: "JavaScript",
      javascript: "JavaScript",
      ts: "TypeScript",
      typescript: "TypeScript",
      md: "Markdown",
      markdown: "Markdown",
      css: "CSS",
      html: "HTML",
      json: "JSON",
      bash: "Bash",
      sh: "Shell",
      shell: "Shell",
    } as Record<string, string>)[language] ?? language : "Text";
    const lines = token.text.replace(/\r\n?/g, "\n").split("\n");
    if (lines.length > 1 && lines.at(-1) === "") lines.pop();
    const lineMarkup = lines.map((line) => `<span class="line">${escapeHtml(line) || " "}</span>`).join("\n");
    const codeClass = language ? ` class="language-${escapeHtml(language)}"` : "";
    const codeMarkup = `<pre><code${codeClass}>${lineMarkup}</code></pre>`;
    const iconMarkup = `<svg class="code-lang-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 5h16v14H4zM6 7v10h12V7zM8 9h8v2H8zm0 4h5v2H8z"/></svg>`;
    const copyMarkup = `<button class="code-copy" type="button" aria-label="复制代码" title="复制代码" data-code-copy="true" data-state="idle"><svg class="icon-copy" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1 0-2 2-2h10c1.1 0 2 .9 2 2"/></svg><svg class="icon-check" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="1.8"/></svg></button>`;
    return `<div class="code-block" data-lang="${escapeHtml(language)}" data-lines="${lines.length}"><div class="code-toolbar"><span class="code-lang">${iconMarkup}<span>${escapeHtml(languageLabel)}</span></span><div class="code-meta"><span class="code-info">UTF-8</span><span class="code-separator">|</span><span class="code-info">${lines.length} Lines</span><span class="code-separator">|</span>${copyMarkup}</div></div>${codeMarkup}</div>`;
  };

  const expandedContent = expandMediaShortcodes(expandArticleReferenceMarkers(content));
  const safeHtmlContent = expandSafeCalloutHtml(expandedContent, specialBlocks);
  const preparedContent = expandCalloutDirectives(safeHtmlContent, references, specialBlocks);
  return sanitizeHtml(marked.parse(preparedContent, { async: false, gfm: true, breaks: false, renderer }), SANITIZE_OPTIONS);
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
    .replace(/^[ \t]*!(?:music|video)\s+.+?[ \t]*$/gmi, " ")
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
