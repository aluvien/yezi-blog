import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, extractHeadings, stripMarkdown } from "../src/lib/markdown.ts";

test("escapes raw HTML instead of executing it", () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">');
  assert.ok(!html.includes("<script"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<img"));
  assert.ok(!/<img[^>]*onerror/i.test(html));
});

test("blocks javascript: URLs in links and images", () => {
  const html = renderMarkdown("[点击](javascript:alert(1))\n\n![图](data:text/html;base64,PHNjcmlwdD4=)");
  assert.ok(!html.includes("javascript:"));
  assert.ok(!html.includes("data:text/html"));
  assert.ok(!html.includes("<a"));
});

test("sanitizes XSS attributes and preserves only supported video and reference output", () => {
  const html = renderMarkdown("<iframe src=\"https://evil.example\" onload=\"alert(1)\"></iframe>\n\n```video\nhttps://evil.example/embed\n```");
  assert.ok(!/<iframe[^>]*onload/i.test(html));
  assert.ok(html.includes("&lt;iframe"));
  assert.ok(!html.includes("evil.example/embed"));
});

test("external links get target and noopener rel", () => {
  const html = renderMarkdown("[外链](https://example.com)");
  assert.ok(html.includes('target="_blank"'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});

test("internal links stay same-tab", () => {
  const html = renderMarkdown("[内链](/posts/a)");
  assert.ok(!html.includes("target="));
});

test("headings get ids for TOC while h1 stays id-less", () => {
  const html = renderMarkdown("## 标题\n### 子标题\n# 一级标题");
  assert.ok(html.includes('<h2 id="heading-1">'));
  assert.ok(html.includes('<h3 id="heading-2">'));
  assert.ok(!/<h1[^>]*id=/.test(html));
});

test("extractHeadings matches the heading ids", () => {
  const headings = extractHeadings("## A\n### B\n## C");
  assert.deepEqual(headings, [
    { id: "heading-1", text: "A", level: 2 },
    { id: "heading-2", text: "B", level: 3 },
    { id: "heading-3", text: "C", level: 2 },
  ]);
});

test("stripMarkdown removes markdown syntax", () => {
  const text = stripMarkdown("## 标题\n**加粗**和[链接](https://x)还有`code`", 200);
  assert.equal(text, "标题 加粗和链接还有code");
});

test("music block renders a container card", () => {
  const html = renderMarkdown("```music\nqqvip:abc123:song\n```");
  assert.ok(html.includes("music"));
  assert.ok(html.includes("qqvip"));
  assert.ok(!html.includes("<pre>"));
});
