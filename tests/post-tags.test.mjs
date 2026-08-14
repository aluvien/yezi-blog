import test from "node:test";
import assert from "node:assert/strict";
import { normalizePostTags, parsePostTags } from "../src/lib/post-tags.ts";

test("normalizes comma and newline separated tags", () => {
  assert.deepEqual(normalizePostTags("Next.js, 设计\n音乐"), ["Next.js", "设计", "音乐"]);
});

test("strips leading # and trims", () => {
  assert.deepEqual(normalizePostTags(" #设计 ,#摄影 "), ["设计", "摄影"]);
});

test("dedupes exact duplicates and caps at 12", () => {
  assert.deepEqual(normalizePostTags(["设计", "设计", "DESIGN"]), ["设计", "DESIGN"]);
  const input = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
  assert.equal(normalizePostTags(input).length, 12);
});

test("drops empty tokens", () => {
  assert.deepEqual(normalizePostTags("   , ,\n ,   valid "), ["valid"]);
  assert.deepEqual(normalizePostTags([]), []);
  assert.deepEqual(normalizePostTags(null), []);
  assert.deepEqual(normalizePostTags(undefined), []);
});

test("parsePostTags parses JSON arrays", () => {
  assert.deepEqual(parsePostTags('["a","b"]'), ["a", "b"]);
  assert.deepEqual(parsePostTags('["  a  ","#b"]'), ["a", "b"]);
});

test("parsePostTags falls back to raw text on bad JSON and nulls", () => {
  assert.deepEqual(parsePostTags("plain,text"), ["plain", "text"]);
  assert.deepEqual(parsePostTags("[broken"), ["[broken"]);
  assert.deepEqual(parsePostTags(null), []);
  assert.deepEqual(parsePostTags(undefined), []);
  assert.deepEqual(parsePostTags(""), []);
});
