import test from "node:test";
import assert from "node:assert/strict";
import { createSlidingWindowLimiter } from "../src/lib/rate-limit.ts";

test("rejects requests over the limit", () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 1_000, maxRequests: 3 });
  assert.equal(limiter("k"), true);
  assert.equal(limiter("k"), true);
  assert.equal(limiter("k"), true);
  assert.equal(limiter("k"), false);
});

test("window slides: expired requests free the slot", async () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 60, maxRequests: 1 });
  assert.equal(limiter("k"), true);
  assert.equal(limiter("k"), false);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(limiter("k"), true);
});

test("keys are isolated from each other", () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 1_000, maxRequests: 1 });
  assert.equal(limiter("a"), true);
  assert.equal(limiter("b"), true);
  assert.equal(limiter("a"), false);
});

test("empty windowMs falls back to a no-op window", () => {
  const limiter = createSlidingWindowLimiter({ windowMs: 0, maxRequests: 1 });
  // 窗口为 0 时 cutoff == now，历史请求会立刻过期，因此几乎总是放行。
  assert.equal(limiter("k"), true);
  assert.equal(limiter("k"), true);
});
