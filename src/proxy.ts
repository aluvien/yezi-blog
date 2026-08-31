import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { productionContentSecurityPolicy } from "@/lib/csp";
import { isDeploymentWriteHoldActive } from "@/lib/deploy-write-guard";

type ProxySecurityContext = {
  nonce?: string;
  requestHeaders?: Headers;
};

function createSecurityContext(request: NextRequest): ProxySecurityContext {
  if (process.env.NODE_ENV !== "production") return {};
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = productionContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(request.headers);
  // Next reads the request CSP while rendering and applies this nonce to its
  // framework scripts. The explicit x-nonce is for our theme bootstrap below.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);
  return { nonce, requestHeaders };
}

function applySecurityHeaders(response: NextResponse, security: ProxySecurityContext): NextResponse {
  if (security.nonce) {
    response.headers.set("Content-Security-Policy", productionContentSecurityPolicy(security.nonce));
  }
  return response;
}

function nextResponse(security: ProxySecurityContext): NextResponse {
  return applySecurityHeaders(
    NextResponse.next(security.requestHeaders ? { request: { headers: security.requestHeaders } } : undefined),
    security,
  );
}

// 第一层保护：仅检查 session cookie 是否存在（proxy 环境无法访问 sqlite）。
// 真正的会话校验在后台布局、Server Actions 和 route handler 内通过数据库完成。
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const security = createSecurityContext(request);
  if (
    process.env.NODE_ENV === "production"
    && process.env.TRUST_PROXY !== "true"
    && (request.headers.has("x-forwarded-for") || request.headers.has("x-real-ip"))
  ) {
    const warningState = globalThis as typeof globalThis & { __yeziProxyHeaderWarning?: boolean };
    if (!warningState.__yeziProxyHeaderWarning) {
      warningState.__yeziProxyHeaderWarning = true;
      console.warn("[security] 收到代理 IP 头但 TRUST_PROXY 未开启；所有访客会共用 unknown 限流桶");
    }
  }

  // A candidate release has already migrated the live SQLite file, but has
  // not yet passed its read-only deploy health checks.  Do not let a public
  // request make rollback unsafe during that short interval.  Admin GETs are
  // held too: an expired session check is allowed to delete its DB record.
  // QQ metadata GETs can populate the persistent metadata cache on a miss.
  const methodCanWrite = !["GET", "HEAD", "OPTIONS"].includes(request.method);
  const routeMayWriteOnGet = pathname === "/api/music/qq"
    || pathname === "/admin"
    || pathname.startsWith("/admin/")
    || pathname === "/api/admin"
    || pathname.startsWith("/api/admin/");
  if (isDeploymentWriteHoldActive() && (methodCanWrite || routeMayWriteOnGet)) {
    const response = pathname.startsWith("/api/")
      ? NextResponse.json({ error: "正在完成安全部署，请稍后重试" }, { status: 503, headers: { "cache-control": "no-store" } })
      : new NextResponse("正在完成安全部署，请稍后重试", { status: 503, headers: { "cache-control": "no-store" } });
    return applySecurityHeaders(response, security);
  }

  // 对外隐藏 Next 图片优化器的内部路径；参数和响应仍由 /_next/image 处理。
  if (pathname === "/image") {
    const target = request.nextUrl.clone();
    target.pathname = "/_next/image";
    return applySecurityHeaders(
      NextResponse.rewrite(target, security.requestHeaders ? { request: { headers: security.requestHeaders } } : undefined),
      security,
    );
  }

  // Next 在动态 catch-all 路由解析前可能无法处理非法百分号编码；提前返回 404，
  // 避免恶意请求把上传路由变成 500。正常上传路径继续直接放行。
  if (pathname.startsWith("/uploads/")) {
    try {
      decodeURIComponent(pathname);
    } catch {
      return applySecurityHeaders(new NextResponse("Not Found", { status: 404 }), security);
    }
    return nextResponse(security);
  }

  const isLoginRoute = pathname === "/admin/login" || pathname === "/api/admin/login";
  const isNativeAdminApi = pathname === "/api/admin/v1" || pathname.startsWith("/api/admin/v1/");
  const needsCookiePresenceCheck = !isLoginRoute && !isNativeAdminApi
    && (pathname.startsWith("/admin/") || pathname.startsWith("/api/admin/"));

  if (needsCookiePresenceCheck && !request.cookies.get("admin_session")?.value) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(NextResponse.json({ error: "未登录" }, { status: 401 }), security);
    }
    const loginUrl = new URL("/admin/login", request.url);
    return applySecurityHeaders(NextResponse.redirect(loginUrl), security);
  }

  return nextResponse(security);
}

export const config = {
  // CSP nonce must be attached before every rendered route. Static assets do
  // not render HTML and are intentionally excluded from this work.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|fonts/|pwa-icon/|manifest.webmanifest|sitemap.xml|rss.xml).*)"],
};
