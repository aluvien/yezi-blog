const JSON_CONTENT_TYPE = "application/json";

function normalizedOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? null : origin.toLowerCase();
  } catch {
    return null;
  }
}

export function requestContentType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
}

export function isJsonRequest(request: Request): boolean {
  return requestContentType(request) === JSON_CONTENT_TYPE;
}

/** Origins that can legitimately reach this request after the configured proxy. */
export function expectedRequestOrigins(request: Request, extraOrigins: string[] = []): Set<string> {
  const result = new Set<string>();
  const requestUrl = new URL(request.url);
  const direct = normalizedOrigin(requestUrl.origin);
  if (direct) result.add(direct);

  const trustedProxy = process.env.TRUST_PROXY === "true";
  const protocol = trustedProxy
    ? request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim() || requestUrl.protocol.replace(":", "")
    : requestUrl.protocol.replace(":", "");
  const host = trustedProxy
    ? request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim() || request.headers.get("host")
    : request.headers.get("host");
  if (host) {
    const forwarded = normalizedOrigin(`${protocol}://${host}`);
    if (forwarded) result.add(forwarded);
  }

  for (const value of [process.env.NEXT_PUBLIC_SITE_URL ?? "", ...extraOrigins]) {
    const origin = normalizedOrigin(value.trim());
    if (origin) result.add(origin);
  }
  return result;
}

export type WriteRequestRejection = { status: 403 | 415; message: string };

export function validateSameOriginWrite(
  request: Request,
  options: { requireJson?: boolean; requireCsrfHeader?: boolean; extraOrigins?: string[] } = {},
): WriteRequestRejection | null {
  if (options.requireJson && !isJsonRequest(request)) {
    return { status: 415, message: "请求必须使用 application/json" };
  }
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return { status: 403, message: "拒绝跨站写入请求" };
  }
  const origin = normalizedOrigin(request.headers.get("origin") ?? "");
  if (!origin || !expectedRequestOrigins(request, options.extraOrigins).has(origin)) {
    return { status: 403, message: "请求来源无效" };
  }
  if (options.requireCsrfHeader && request.headers.get("x-yezi-csrf") !== "1") {
    return { status: 403, message: "缺少 CSRF 校验" };
  }
  return null;
}

export function validatePublicWriteRequest(request: Request): WriteRequestRejection | null {
  if (!isJsonRequest(request)) return { status: 415, message: "请求必须使用 application/json" };
  if (request.headers.get("sec-fetch-site")?.toLowerCase() === "cross-site") {
    return { status: 403, message: "拒绝跨站写入请求" };
  }
  const corsOrigin = process.env.API_CORS_ORIGIN?.trim();
  if (request.headers.get("origin")) {
    return validateSameOriginWrite(request, { requireJson: true, extraOrigins: corsOrigin ? [corsOrigin] : [] });
  }
  // Native apps already send a non-simple installation UUID. Browsers cannot
  // add this header cross-site without a successful CORS preflight, while the
  // server still applies IP rate limits independently of the UUID.
  const nativeId = request.headers.get("x-yezi-visitor-id")?.trim() ?? "";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nativeId)) return null;
  return { status: 403, message: "请求来源无效" };
}
