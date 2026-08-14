import { parseHTML } from "linkedom";
import sanitizeHtml from "sanitize-html";

const MAX_READER_TEXT_LENGTH = 200_000;

function parseReaderFragment(value: string) {
  return parseHTML(`<!doctype html><html><body>${value}</body></html>`);
}

function readerFragmentHtml(document: ReturnType<typeof parseHTML>["document"], fallback: string): string {
  return document.body?.innerHTML || fallback;
}

/** Extract text for reader search, summaries and AI blocks without image alt-text noise. */
export function archiveReaderText(value: string): string {
  const { document } = parseReaderFragment(value);
  for (const image of Array.from(document.querySelectorAll("img"))) image.remove();
  return sanitizeHtml(readerFragmentHtml(document, value), { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_READER_TEXT_LENGTH);
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_[\]<>])/g, "\\$1");
}

function markdownDestination(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/([()])/g, "\\$1");
}

function markdownInlineCode(value: string): string {
  const ticks = value.match(/`+/g)?.reduce((longest, item) => Math.max(longest, item.length), 0) ?? 0;
  const fence = "`".repeat(ticks + 1);
  return `${fence}${value.startsWith("`") || value.endsWith("`") ? ` ${value} ` : value}${fence}`;
}

function normalizeMarkdown(value: string): string {
  return value.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function markdownInline(node: Node): string {
  if (node.nodeType === 3) return escapeMarkdownText((node.textContent || "").replace(/\s+/g, " "));
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const children = () => Array.from(element.childNodes).map(markdownInline).join("");
  if (tag === "br") return "  \n";
  if (tag === "strong" || tag === "b") return `**${children().trim()}**`;
  if (tag === "em" || tag === "i") return `*${children().trim()}*`;
  if (tag === "del" || tag === "s") return `~~${children().trim()}~~`;
  if (tag === "code" && element.parentElement?.tagName.toLowerCase() !== "pre") return markdownInlineCode(element.textContent || "");
  if (tag === "a") {
    const label = children().trim();
    const href = element.getAttribute("href") || "";
    return href ? `[${label || escapeMarkdownText(href)}](${markdownDestination(href)})` : label;
  }
  if (tag === "img") {
    const src = element.getAttribute("src") || "";
    return src ? `![](${markdownDestination(src)})` : "";
  }
  return children();
}

function tableCellMarkdown(element: Element): string {
  return normalizeMarkdown(Array.from(element.childNodes).map(markdownInline).join("")).replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function tableMarkdown(element: Element): string {
  const rows = Array.from(element.querySelectorAll("tr"))
    .map((row) => Array.from(row.children).filter((cell) => /^(?:th|td)$/i.test(cell.tagName)).map(tableCellMarkdown))
    .filter((row) => row.length > 0);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const complete = rows.map((row) => [...row, ...Array.from({ length: width - row.length }, () => "")]);
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  return `${line(complete[0])}\n${line(Array.from({ length: width }, () => "---"))}${complete.slice(1).map((row) => `\n${line(row)}`).join("")}`;
}

function listMarkdown(element: Element, depth = 0): string {
  const ordered = element.tagName.toLowerCase() === "ol";
  let index = Number(element.getAttribute("start")) || 1;
  const lines: string[] = [];
  for (const item of Array.from(element.children).filter((child) => child.tagName.toLowerCase() === "li")) {
    const nested = Array.from(item.children).filter((child) => /^(?:ul|ol)$/i.test(child.tagName));
    const clone = item.cloneNode(true) as Element;
    for (const child of Array.from(clone.children).filter((node) => /^(?:ul|ol)$/i.test(node.tagName))) child.remove();
    const text = normalizeMarkdown(Array.from(clone.childNodes).map(markdownInline).join(""));
    lines.push(`${"  ".repeat(depth)}${ordered ? `${index}. ` : "- "}${text}`);
    for (const child of nested) lines.push(listMarkdown(child, depth + 1));
    index += 1;
  }
  return lines.join("\n");
}

function markdownBlock(node: Node): string {
  if (node.nodeType === 3) return escapeMarkdownText((node.textContent || "").replace(/\s+/g, " ")).trim();
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const inline = () => normalizeMarkdown(Array.from(element.childNodes).map(markdownInline).join(""));
  const blocks = () => Array.from(element.childNodes).map(markdownBlock).filter(Boolean).join("\n\n");
  if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag.slice(1)))} ${inline()}`;
  if (tag === "p") return inline();
  if (tag === "hr") return "---";
  if (tag === "blockquote") return blocks().split("\n").map((line) => `> ${line}`).join("\n");
  if (tag === "pre") {
    const code = element.querySelector("code");
    const language = code?.getAttribute("class")?.match(/(?:language-|lang-)([\w+-]+)/)?.[1] || "";
    const content = (code?.textContent || element.textContent || "").replace(/\n+$/, "");
    const fence = "`".repeat(Math.max(3, (content.match(/`+/g)?.reduce((longest, item) => Math.max(longest, item.length), 0) ?? 0) + 1));
    return `${fence}${language}\n${content}\n${fence}`;
  }
  if (tag === "ul" || tag === "ol") return listMarkdown(element);
  if (tag === "table") return tableMarkdown(element);
  if (tag === "figure") {
    const code = element.querySelector("pre");
    if (code) return markdownBlock(code);
    const imageMarkdown = Array.from(element.querySelectorAll("img")).map((image) => markdownInline(image)).filter(Boolean).join("\n\n");
    const caption = element.querySelector("figcaption")?.textContent?.replace(/\s+/g, " ").trim() || "";
    const fallbackContent = imageMarkdown ? "" : Array.from(element.childNodes)
      .filter((child) => !(child.nodeType === 1 && (child as Element).tagName.toLowerCase() === "figcaption"))
      .map(markdownBlock).filter(Boolean).join("\n\n");
    return [imageMarkdown || fallbackContent, caption ? `*${escapeMarkdownText(caption)}*` : ""].filter(Boolean).join("\n\n");
  }
  if (tag === "img") return markdownInline(element);
  if (tag === "dl") return Array.from(element.children).map((child) => {
    const text = normalizeMarkdown(Array.from(child.childNodes).map(markdownInline).join(""));
    return child.tagName.toLowerCase() === "dt" ? `**${text}**` : text;
  }).filter(Boolean).join("\n\n");
  return blocks();
}

/** Convert sanitized reader HTML to GFM Markdown so new and old archives share one renderer. */
export function referenceReaderHtmlToMarkdown(value: string): string {
  const { document } = parseReaderFragment(value);
  return normalizeMarkdown(Array.from(document.body.childNodes).map(markdownBlock).filter(Boolean).join("\n\n"));
}
