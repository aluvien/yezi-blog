import test from "node:test";
import assert from "node:assert/strict";
import { productionContentSecurityPolicy } from "../src/lib/csp.ts";

test("production CSP preserves supported content sources and requires a nonce for scripts", () => {
  const policy = productionContentSecurityPolicy("test-nonce");
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /frame-ancestors 'self'/);
  assert.match(policy, /frame-src https:\/\/player\.bilibili\.com https:\/\/www\.bilibili\.com https:\/\/www\.youtube-nocookie\.com/);
  assert.match(policy, /img-src 'self' data: blob: https:/);
  assert.match(policy, /script-src 'self' 'nonce-test-nonce' 'strict-dynamic'/);
  assert.doesNotMatch(policy, /script-src[^;]*unsafe-inline/);
});
