import test from "node:test";
import assert from "node:assert/strict";
import { BoundedSingleFlight } from "../src/lib/bounded-single-flight.ts";

test("ten identical resolutions share one in-flight task", async () => {
  const resolver = new BoundedSingleFlight({ timeoutMs: 1_000, failureCacheMs: 100, maxConcurrent: 4 });
  let calls = 0;
  const requests = Array.from({ length: 10 }, () => resolver.run("playlist:1", async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return "ok";
  }));
  assert.deepEqual(await Promise.all(requests), Array(10).fill("ok"));
  assert.equal(calls, 1);
});

test("distinct work is bounded and failures are cached briefly", async () => {
  const resolver = new BoundedSingleFlight({ timeoutMs: 1_000, failureCacheMs: 1_000, maxConcurrent: 1 });
  let release;
  const first = resolver.run("one", () => new Promise((resolve) => { release = resolve; }));
  await assert.rejects(resolver.run("two", async () => "two"), /服务繁忙/);
  release("one");
  assert.equal(await first, "one");

  let failedCalls = 0;
  await assert.rejects(resolver.run("bad", async () => { failedCalls += 1; throw new Error("upstream"); }), /upstream/);
  await assert.rejects(resolver.run("bad", async () => { failedCalls += 1; return "unexpected"; }), /暂时不可用/);
  assert.equal(failedCalls, 1);
});

test("the absolute timeout signal terminates a cooperative slow task", async () => {
  const resolver = new BoundedSingleFlight({ timeoutMs: 25, failureCacheMs: 10, maxConcurrent: 1 });
  const started = Date.now();
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    await assert.rejects(resolver.run("slow", (signal) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    })), /timeout/i);
    assert.ok(Date.now() - started < 500);
  } finally {
    clearTimeout(keepAlive);
  }
});
