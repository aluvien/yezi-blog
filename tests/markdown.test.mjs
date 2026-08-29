import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown, extractHeadings, stripMarkdown } from "../src/lib/markdown.ts";
import { normalizeMediaShortcodes } from "../src/lib/media-shortcodes.ts";

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

test("renders target-style Markdown lists, links, divider and code metadata", () => {
  const html = renderMarkdown("- 第一项\n- 第二项\n\n1. 第一步\n2. 第二步\n\n[目标链接](https://example.com)\n\n---\n\n```ts\nconst answer = 42;\n```");
  assert.ok(html.includes("<ul>"));
  assert.ok(html.includes("<ol>"));
  assert.ok(html.includes('<a href="https://example.com"'));
  assert.ok(html.includes("<hr"));
  assert.ok(html.includes('<div class="code-block"'));
  assert.ok(html.includes('data-lang="ts"'));
  assert.ok(html.includes('data-code-copy="true"'));
  assert.ok(html.includes('class="line"'));
});

test("music block renders a container card", () => {
  const html = renderMarkdown("```music\nqqvip:abc123:song\n```");
  assert.ok(html.includes("music"));
  assert.ok(html.includes("qqvip"));
  assert.ok(!html.includes("<pre>"));
});

test("article media shortcodes render music and supported video embeds", () => {
  const html = renderMarkdown([
    "正文前。",
    "",
    "!music qqvip:abc123:song",
    "",
    "!video https://www.bilibili.com/video/BV13JMi6yE4p?p=2",
    "",
    "正文后。",
  ].join("\n"));
  assert.ok(html.includes('data-server="qqvip"'));
  assert.ok(html.includes('data-video-platform="bilibili"'));
  assert.ok(html.includes("bvid=BV13JMi6yE4p"));
  assert.ok(html.includes("page=2"));
  assert.ok(!html.includes("!music"));
  assert.ok(!html.includes("!video"));
});

test("article shortcodes work without Markdown paragraph spacing and use the compact video form", () => {
  const html = renderMarkdown([
    "正文前。",
    "!music qqvip:abc123:song",
    "正文中。",
    "!video bilibili:BV13JMi6yE4p:2",
    "正文后。",
  ].join("\n"));
  assert.ok(html.includes('data-server="qqvip"'));
  assert.ok(html.includes('data-video-platform="bilibili"'));
  assert.ok(html.includes("bvid=BV13JMi6yE4p"));
  assert.ok(html.includes("page=2"));
  assert.ok(!html.includes("!music"));
  assert.ok(!html.includes("!video"));
});

test("renders Whono callout directives with safe nested Markdown", () => {
  const html = renderMarkdown(":::note[提示]\n这是 **正文**。\n:::");
  assert.ok(html.includes('<div class="callout note">'));
  assert.ok(html.includes('<p class="callout-title">提示</p>'));
  assert.ok(html.includes("<strong>正文</strong>"));
  assert.ok(!html.includes(":::"));
});

test("renders the pullquote variant and keeps citation markup", () => {
  const html = renderMarkdown(":::pullquote\n一句重要的话。\n<cite>— 作者</cite>\n:::");
  assert.ok(html.includes('<blockquote class="pullquote">'));
  assert.ok(html.includes("<cite>— 作者</cite>"));
  assert.ok(!html.includes(":::"));
});

test("preserves only the supported callout HTML shape", () => {
  const html = renderMarkdown('<div class="callout note"><p class="callout-title" data-icon="none">标题</p><p>正文<script>alert(1)</script></p></div>');
  assert.ok(html.includes('<div class="callout note">'));
  assert.ok(html.includes('data-icon="none"'));
  assert.ok(!html.includes("<script"));
});

test("saving media shortcodes canonicalizes pasted video URLs to compact specs", () => {
  const content = normalizeMediaShortcodes("!video https://www.bilibili.com/video/BV13JMi6yE4p?p=2\n!video https://youtu.be/dQw4w9WgXcQ");
  assert.equal(content, "!video bilibili:BV13JMi6yE4p:2\n!video youtube:dQw4w9WgXcQ");
});

test("saving media shortcodes removes legacy music metadata snapshots", () => {
  const legacy = "!music qqvip:abc123:song:meta-%7B%22title%22%3A%22%E6%AD%8C%22%7D";
  assert.equal(normalizeMediaShortcodes(legacy), "!music qqvip:abc123:song");
});

test("invalid media shortcodes remain plain text", () => {
  const html = renderMarkdown("!video https://evil.example/embed");
  assert.ok(html.includes("!video"));
  assert.ok(!html.includes("<iframe"));
});
