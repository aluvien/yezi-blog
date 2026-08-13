import test from "node:test";
import assert from "node:assert/strict";
import { parseXStatusUrl } from "../src/lib/article-reference-url.ts";

test("normalizes X status links to a stable cache URL", () => {
  assert.deepEqual(
    parseXStatusUrl("https://x.com/ai_xiaomu/status/2061003331531862349?s=46"),
    { id: "2061003331531862349", username: "ai_xiaomu", canonicalUrl: "https://x.com/ai_xiaomu/status/2061003331531862349" },
  );
  assert.deepEqual(
    parseXStatusUrl("https://twitter.com/ai_xiaomu/status/2061003331531862349/photo/1#media"),
    { id: "2061003331531862349", username: "ai_xiaomu", canonicalUrl: "https://x.com/ai_xiaomu/status/2061003331531862349" },
  );
});

test("normalizes generic X status links without inventing an author", () => {
  assert.deepEqual(
    parseXStatusUrl("https://x.com/i/web/status/2061003331531862349?ref=share"),
    { id: "2061003331531862349", username: "", canonicalUrl: "https://x.com/i/web/status/2061003331531862349" },
  );
});
