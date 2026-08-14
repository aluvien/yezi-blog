import test from "node:test";
import assert from "node:assert/strict";
import { productionContentSecurityPolicy } from "../next.config.ts";

test("production CSP preserves supported content sources while denying risky defaults", () => {
  const policy = productionContentSecurityPolicy();
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /frame-ancestors 'self'/);
  assert.match(policy, /frame-src https:\/\/player\.bilibili\.com https:\/\/www\.youtube-nocookie\.com/);
  assert.match(policy, /img-src 'self' data: blob: https:/);
});
