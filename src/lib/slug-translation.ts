import { slugify } from "@/lib/slug";

const DEFAULT_LLM_ENDPOINT = "https://api.openai.com/v1/chat/completions";
// 文章标题翻译通常很快，但自建/兼容 OpenAI 的模型首次唤醒可能需要几秒；
// 留出足够时间避免误判为失败后直接落到拼音 slug。
const LLM_TIMEOUT_MS = 30_000;

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
async function requestTitleTranslation(title: string): Promise<{ slug: string | null; fallbackReason?: string }> {
  const apiKey = process.env.LLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  const source = title.trim().slice(0, 240);
  if (!source) return { slug: null };
  if (!apiKey) return { slug: null, fallbackReason: "网站进程未读取到模型密钥，请检查环境文件和启动配置" };

  let endpoint: string;
  try {
    endpoint = resolveLlmEndpoint(process.env.LLM_API_URL || "");
  } catch {
    return { slug: null, fallbackReason: "模型接口配置无效，请检查 LLM_API_URL" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
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
    if (!response.ok) {
      const status = response.status;
      const reason = status === 401 || status === 403
        ? "模型服务鉴权失败，请检查网站实际使用的密钥"
        : status === 404
          ? "模型接口或模型名称不匹配，请检查 LLM_API_URL / LLM_MODEL"
          : status === 429
            ? "模型服务限流或额度不足，请稍后重试或检查服务额度"
            : "模型服务请求失败";
      return { slug: null, fallbackReason: `${reason}（HTTP ${status}）` };
    }
    let payload: { choices?: Array<{ finish_reason?: string; message?: { content?: unknown } }> };
    try {
      payload = await response.json();
    } catch {
      return { slug: null, fallbackReason: "模型返回了无法读取的响应" };
    }
    const choice = payload?.choices?.[0];
    const slug = normalizeModelSlug(extractText(choice?.message?.content));
    return slug ? { slug } : {
      slug: null,
      fallbackReason: choice?.finish_reason === "length"
        ? "模型输出被长度限制截断，未得到有效英文链接"
        : "模型未返回有效英文链接，请检查模型配置",
    };
  } catch (error) {
    return {
      slug: null,
      fallbackReason: controller.signal.aborted || (error instanceof Error && error.name === "AbortError")
        ? "模型请求超时（30 秒）"
        : "无法连接模型服务，请检查服务器网络和接口地址",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function translateTitleToEnglishSlug(title: string): Promise<string | null> {
  return (await requestTitleTranslation(title)).slug;
}

/** 测试与调用方共用的安全兜底，确保永远能得到本地可用 slug。 */
export function localSlugFallback(title: string): string {
  return slugify(title);
}

export type GeneratedTitleSlug = {
  slug: string;
  source: "llm" | "fallback";
  fallbackReason?: string;
};

/**
 * 统一文章 slug 的生成入口：优先请求已配置的 LLM，失败或未配置时
 * 使用本地拼音规则兜底。保存文章和后台手动生成按钮都走这里，避免两
 * 条路径的行为不一致。
 */
export async function generateTitleSlug(title: string): Promise<GeneratedTitleSlug | null> {
  const source = title.trim();
  if (!source) return null;

  const translated = await requestTitleTranslation(source);
  if (translated.slug) return { slug: translated.slug, source: "llm" };

  const fallback = localSlugFallback(source);
  return fallback ? { slug: fallback, source: "fallback", fallbackReason: translated.fallbackReason } : null;
}
