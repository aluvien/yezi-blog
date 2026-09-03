import { slugify } from "@/lib/slug";

const DEFAULT_LLM_ENDPOINT = "https://api.openai.com/v1/chat/completions";
const LLM_TIMEOUT_MS = 8_000;

function resolveLlmEndpoint(input: string): string {
  const raw = input.trim() || DEFAULT_LLM_ENDPOINT;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("LLM_API_URL 只支持 http 或 https");
  const pathname = url.pathname.replace(/\/+$/, "");
  if (!pathname || pathname === "/") url.pathname = "/v1/chat/completions";
  else if (pathname.endsWith("/v1")) url.pathname = `${pathname}/chat/completions`;
  else url.pathname = pathname;
  return url.toString();
}

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.map((part) => part && typeof part === "object" && "text" in part ? String((part as { text?: unknown }).text ?? "") : typeof part === "string" ? part : "").join("");
}

function normalizeModelSlug(value: string): string | null {
  const cleaned = value
    .trim()
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim();
  if (!cleaned) return null;

  let candidate = cleaned;
  try {
    // 模型偶尔会在 JSON 前后附带一句解释或 `<think>` 片段；沿用摘要
    // 接口的宽容解析策略，只取第一个完整对象，避免把解释误写成 slug。
    const jsonText = cleaned.match(/\{[\s\S]*\}/)?.[0] ?? cleaned;
    const parsed = JSON.parse(jsonText) as { slug?: unknown; translation?: unknown; title?: unknown };
    candidate = String(parsed.slug ?? parsed.translation ?? parsed.title ?? "");
  } catch {
    const line = cleaned
      .replace(/<think>[\s\S]*?<\/think>/gi, "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .find((item) => /^(?:slug|translation|english)\s*[:：]/i.test(item) || /^[a-z0-9][a-z0-9 -]*$/i.test(item)) ?? "";
    candidate = line.replace(/^(?:slug|translation|english)\s*[:：]\s*/i, "");
  }

  // 只接受模型给出的 ASCII 英文/数字候选；中文或其他文字交给本地
  // slugify 兜底，避免把不可分享的空 slug 写入数据库。
  if (!/^[\x00-\x7f]+$/.test(candidate)) return null;
  const normalized = candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
  return normalized || null;
}

/**
 * 用已配置的 LLM 把中文标题翻译为便于分享的英文 slug。
 * 未配置、超时或返回异常时返回 null，由调用方继续使用本地 slugify。
 */
export async function translateTitleToEnglishSlug(title: string): Promise<string | null> {
  const apiKey = process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const source = title.trim().slice(0, 240);
  if (!apiKey || !source) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch(resolveLlmEndpoint(process.env.LLM_API_URL || ""), {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.LLM_MODEL?.trim() || "gpt-4o-mini",
        temperature: 0,
        max_tokens: 40,
        messages: [
          {
            role: "system",
            content: "把用户提供的文章标题翻译成简洁自然的英文 URL slug。只输出 JSON，不要 Markdown 或解释：{\"slug\":\"lowercase-english-words\"}。仅使用 ASCII 小写字母、数字和连字符，最多 80 个字符。不要添加日期、作者或不存在的信息。",
          },
          { role: "user", content: source },
        ],
      }),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    return normalizeModelSlug(extractText(payload.choices?.[0]?.message?.content));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 测试与调用方共用的安全兜底，确保永远能得到本地可用 slug。 */
export function localSlugFallback(title: string): string {
  return slugify(title);
}
