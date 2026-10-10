import test from "node:test";
import assert from "node:assert/strict";
import { slugify } from "../src/lib/slug.ts";
import { generateTitleSlug } from "../src/lib/slug-translation.ts";

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

test("prefers the configured LLM for title slugs", async () => {
  const keys = ["LLM_API_KEY", "OPENAI_API_KEY", "LLM_API_URL", "LLM_MODEL"];
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  try {
    process.env.LLM_API_KEY = "test-key";
    delete process.env.OPENAI_API_KEY;
    process.env.LLM_API_URL = "https://llm.example.test/v1";
    process.env.LLM_MODEL = "test-model";
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("authorization"), "Bearer test-key");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"slug":"A calm morning"}' } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    assert.deepEqual(await generateTitleSlug("一段中文标题"), { slug: "a-calm-morning", source: "llm" });
    assert.equal(requestUrl, "https://llm.example.test/v1/chat/completions");
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("falls back to the local slug rule when LLM is unavailable", async () => {
  const previous = {
    LLM_API_KEY: process.env.LLM_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  };
  delete process.env.LLM_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    assert.deepEqual(await generateTitleSlug("你好世界"), { slug: "ni-hao-shi-jie", source: "fallback", fallbackReason: "网站进程未读取到模型密钥，请检查环境文件和启动配置" });
  } finally {
    for (const key of Object.keys(previous)) {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

async function withModelFixture(callback) {
  const keys = ["LLM_API_KEY", "OPENAI_API_KEY", "LLM_API_URL", "LLM_MODEL"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.LLM_API_KEY = "private-test-key";
    delete process.env.OPENAI_API_KEY;
    process.env.LLM_API_URL = "https://llm.example.test/v1";
    process.env.LLM_MODEL = "test-model";
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

for (const [status, expected] of [[401, "鉴权失败"], [403, "鉴权失败"], [404, "模型名称不匹配"], [429, "限流或额度不足"], [503, "请求失败"]]) {
  test(`reports HTTP ${status} without exposing provider response or credentials`, async () => {
    await withModelFixture(async () => {
      globalThis.fetch = async () => new Response("provider echoed private-test-key", { status });
      const result = await generateTitleSlug("你好世界");
      assert.equal(result.slug, "ni-hao-shi-jie");
      assert.equal(result.source, "fallback");
      assert.ok(result.fallbackReason.includes(expected));
      assert.ok(result.fallbackReason.includes(`HTTP ${status}`));
      assert.ok(!JSON.stringify(result).includes("private-test-key"));
    });
  });
}

for (const [name, error, expected] of [["timeout", new DOMException("private-test-key", "AbortError"), "超时"], ["network failure", new Error("private-test-key"), "无法连接"]]) {
  test(`reports ${name} while preserving the local fallback`, async () => {
    await withModelFixture(async () => {
      globalThis.fetch = async () => { throw error; };
      const result = await generateTitleSlug("你好世界");
      assert.equal(result.source, "fallback");
      assert.ok(result.fallbackReason.includes(expected));
      assert.ok(!result.fallbackReason.includes("private-test-key"));
    });
  });
}

test("reports truncated and malformed model responses distinctly", async () => {
  await withModelFixture(async () => {
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: "length", message: { content: "" } }] });
    assert.match((await generateTitleSlug("你好世界")).fallbackReason, /长度限制截断/);
    globalThis.fetch = async () => new Response("not JSON");
    assert.match((await generateTitleSlug("你好世界")).fallbackReason, /无法读取的响应/);
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: "中文内容" } }] });
    assert.match((await generateTitleSlug("你好世界")).fallbackReason, /未返回有效英文链接/);
    process.env.LLM_API_URL = "invalid URL";
    globalThis.fetch = async () => { throw new Error("must not fetch"); };
    assert.match((await generateTitleSlug("你好世界")).fallbackReason, /接口配置无效/);
  });
});
