import { NextResponse } from "next/server";
import { normalizeReferenceUrl } from "@/lib/article-reference-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

function imageError(message: string, status = 404): NextResponse {
  return new NextResponse(message, {
    status,
    headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" },
  });
}

async function readImageBytes(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) throw new Error("图片过大");
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error("图片过大");
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = MAX_IMAGE_BYTES - size;
      if (remaining <= 0 || value.byteLength > remaining) {
        await reader.cancel();
        throw new Error("图片过大");
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  let current: string;
  let referer = "";
  try {
    current = normalizeReferenceUrl(requestUrl.searchParams.get("url") || "");
    const rawReferer = requestUrl.searchParams.get("referer") || "";
    referer = rawReferer ? normalizeReferenceUrl(rawReferer) : "";
  } catch {
    return imageError("图片地址无效");
  }

  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(current, {
          cache: "no-store",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            referer: referer || current,
            // 部分公众号图片会校验 Referer 和 User-Agent。
            "user-agent": "Mozilla/5.0 (compatible; YeziBlogReference/1.0; +https://yezi.me)",
          },
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("图片读取超时");
        throw new Error("图片读取失败");
      } finally {
        clearTimeout(timer);
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || redirect === MAX_REDIRECTS) throw new Error("图片跳转次数过多");
        current = normalizeReferenceUrl(new URL(location, current).toString());
        continue;
      }
      if (!response.ok) throw new Error(`图片返回 ${response.status}`);

      const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() || "";
      if (contentType && !contentType.startsWith("image/")) throw new Error("返回内容不是图片");
      const bytes = await readImageBytes(response);
      const body = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(body).set(bytes);
      return new NextResponse(body, {
        headers: {
          "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
          "content-type": contentType || "image/jpeg",
          "x-content-type-options": "nosniff",
        },
      });
    }
  } catch (error) {
    return imageError(error instanceof Error ? error.message : "图片读取失败");
  }
  return imageError("图片读取失败");
}
