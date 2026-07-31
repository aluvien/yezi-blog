import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// 第一层保护：仅检查 session cookie 是否存在（proxy 环境无法访问 sqlite）。
// 真正的会话校验在后台布局、Server Actions 和 route handler 内通过数据库完成。
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 登录页与登录 API 放行
  if (pathname === "/admin/login" || pathname === "/api/admin/login") {
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
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
