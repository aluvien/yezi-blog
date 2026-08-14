import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/lib/slug.ts";

test("slugifies English titles", () => {
  assert.equal(slugify("Hello World"), "hello-world");
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  Trim  Me  "), "trim-me");
});

test("romanizes Chinese with pinyin", () => {
  assert.equal(slugify("你好世界"), "ni-hao-shi-jie");
});

test("collapses separators to a single dash", () => {
  assert.equal(slugify("a  b--c"), "a-b-c");
  assert.equal(slugify("Top 10 tips & tricks"), "top-10-tips-tricks");
});

test("handles empty and dash-only input", () => {
  assert.equal(slugify(""), "");
  assert.equal(slugify("!!!---"), "");
});

test("truncates to 80 chars without trailing dash", () => {
  const slug = slugify(`${"x".repeat(100)} ----`);
  assert.ok(slug.length <= 80);
  assert.ok(!slug.endsWith("-"));
  assert.match(slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});
