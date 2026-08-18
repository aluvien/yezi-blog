import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 第一层保护：仅检查 session cookie 是否存在（proxy 环境无法访问 sqlite）。
// 真正的会话校验在后台布局、Server Actions 和 route handler 内通过数据库完成。
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 对外隐藏 Next 图片优化器的内部路径；参数和响应仍由 /_next/image 处理。
  if (pathname === "/image") {
    const target = request.nextUrl.clone();
    target.pathname = "/_next/image";
    return NextResponse.rewrite(target);
  }

  // Next 在动态 catch-all 路由解析前可能无法处理非法百分号编码；提前返回 404，
  // 避免恶意请求把上传路由变成 500。正常上传路径继续直接放行。
  if (pathname.startsWith("/uploads/")) {
    try {
      decodeURIComponent(pathname);
    } catch {
      return new NextResponse("Not Found", { status: 404 });
    }
    return NextResponse.next();
  }

  // 登录页与登录 API 放行
  if (pathname === "/admin/login" || pathname === "/api/admin/login") {
    return NextResponse.next();
  }

  // 原生 App 管理 API 必须由 Route Handler 统一返回 REST JSON envelope；
  // 具体会话校验由 requireAdminApi() 完成，不能在 proxy 层提前返回旧格式。
  if (pathname === "/api/admin/v1" || pathname.startsWith("/api/admin/v1/")) {
    return NextResponse.next();
  }

  const token = request.cookies.get("admin_session")?.value;
  if (!token) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "未登录" }, { status: 401 });
    }
    const loginUrl = new URL("/admin/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/uploads/:path*", "/image"],
};
