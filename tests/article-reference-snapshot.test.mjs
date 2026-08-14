import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeArticleReferenceSnapshot,
  formatArticleReferenceDate,
  articleReferenceToken,
  encodeArticleReferenceMarker,
  decodeArticleReferencePayload,
  parseArticleReferenceMarkers,
  expandArticleReferenceMarkers,
} from "../src/lib/article-reference.ts";

const sample = {
  url: "https://example.com/article",
  canonicalUrl: "https://example.com/article",
  title: "示例文章",
  source: "示例站",
  author: "作者",
  publishedAt: "2023-01-01",
  cover: "https://example.com/cover.jpg",
  description: "描述",
  summary: "摘要",
  keyPoints: ["要点一", "要点二"],
};

test("normalizeArticleReferenceSnapshot strips hash, trims and clamps", () => {
  const snapshot = normalizeArticleReferenceSnapshot({
    url: "https://example.com/a?b=1#frag",
    title: "  Title  ",
    keyPoints: ["p1", "", "   ", "p".repeat(300)],
  });
  assert.equal(snapshot.url, "https://example.com/a?b=1");
  assert.equal(snapshot.title, "Title");
  assert.equal(snapshot.keyPoints.length, 2);
  assert.equal(snapshot.keyPoints[1].length, 180);
});

test("normalizeArticleReferenceSnapshot rejects non-http protocols", () => {
  assert.equal(normalizeArticleReferenceSnapshot({ url: "javascript:alert(1)" }).url, "");
  assert.equal(normalizeArticleReferenceSnapshot({ url: "ftp://example.com" }).url, "");
  assert.equal(normalizeArticleReferenceSnapshot({ url: "" }).url, "");
});

test("normalizeArticleReferenceSnapshot falls back to 引用文章 title", () => {
  const snapshot = normalizeArticleReferenceSnapshot({ url: "https://example.com/x" });
  assert.equal(snapshot.title, "引用文章");
  assert.equal(snapshot.canonicalUrl, snapshot.url);
});

test("formatArticleReferenceDate converts unix timestamps to Shanghai date", () => {
  assert.equal(formatArticleReferenceDate("1700000000"), "2023-11-15");
  assert.equal(formatArticleReferenceDate("1700000000000"), "2023-11-15");
  assert.equal(formatArticleReferenceDate(""), "");
  assert.equal(formatArticleReferenceDate("0"), "");
  assert.equal(formatArticleReferenceDate("null"), "");
});

test("articleReferenceToken is stable and unique", () => {
  const token1 = articleReferenceToken(sample);
  assert.equal(token1, articleReferenceToken(sample));
  assert.match(token1, /^r[0-9a-z]{14}$/);
  const other = articleReferenceToken({ ...sample, url: "https://example.com/other", canonicalUrl: "https://example.com/other" });
  assert.notEqual(token1, other);
});

test("encode and decode markers round-trip", () => {
  const marker = encodeArticleReferenceMarker(sample);
  assert.match(marker, /^!reference:r[0-9a-z]{14}$/);
  const payload = marker.slice("!reference:".length);
  const decoded = decodeArticleReferencePayload(payload, [sample]);
  assert.equal(decoded?.url, sample.url);
  assert.equal(decoded?.title, sample.title);
});

test("decodeArticleReferencePayload handles compact base64url snapshots", () => {
  const compact = Buffer.from(JSON.stringify({ u: sample.url, t: "Test" }), "utf8").toString("base64");
  const decoded = decodeArticleReferencePayload(compact);
  assert.equal(decoded?.url, sample.url);
  assert.equal(decoded?.title, "Test");
});

test("parseArticleReferenceMarkers collects snapshots from content", () => {
  const marker = encodeArticleReferenceMarker(sample);
  const content = `开头\n${marker}\n结尾`;
  const parsed = parseArticleReferenceMarkers(content, [sample]);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].url, sample.url);
});

test("expandArticleReferenceMarkers turns markers into reference code blocks", () => {
  const marker = encodeArticleReferenceMarker(sample);
  const expanded = expandArticleReferenceMarkers(`前\n${marker}\n后`);
  assert.ok(expanded.includes("```reference"));
  assert.ok(expanded.includes(marker.slice("!reference:".length)));
});
