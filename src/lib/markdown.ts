import { marked } from "marked";

export interface TocHeading {
  id: string;
  text: string;
  level: number;
}

/**
 * 渲染文章 markdown 为 HTML。
 * h2/h3 会自动添加 id 属性用于 TOC 锚点。
 */
export function renderMarkdown(content: string): string {
  const renderer = new marked.Renderer();
  let counter = 0;

  renderer.heading = function ({ text, depth }: { text: string; depth: number }) {
    if (depth <= 3) {
      const id = `heading-${++counter}`;
      return `<h${depth} id="${id}">${text}</h${depth}>`;
    }
    return `<h${depth}>${text}</h${depth}>`;
  };

  return marked.parse(content, { async: false, gfm: true, breaks: false, renderer });
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
