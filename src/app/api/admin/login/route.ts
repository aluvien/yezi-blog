import { NextResponse } from "next/server";
import { login } from "@/lib/auth";
import { getClientIp, readLimitedJson, RequestBodyError } from "@/lib/request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let password = "";
  try {
    const body = await readLimitedJson<{ password?: unknown }>(request, 4 * 1024);
    password = String(body?.password ?? "");
  } catch (error) {
    const status = error instanceof RequestBodyError ? error.status : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "请求格式错误" }, { status });
  }
  if (!password || password.length > 512) return NextResponse.json({ error: "密码格式错误" }, { status: 400 });
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "服务器未配置 ADMIN_PASSWORD" }, { status: 500 });
  }
  // 反向代理只在显式开启 TRUST_PROXY 时信任 x-forwarded-proto，
  // 避免直连时客户端伪造协议头强制 Secure cookie（会自锁登录态）。
  let requestProtocol: string | null = null;
  if (process.env.TRUST_PROXY === "true") {
    requestProtocol = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? null;
  }
  const requestSecure = requestProtocol === "https" || new URL(request.url).protocol === "https:";
  // 显式配置的 SESSION_COOKIE_SECURE 优先于自动判定
  const secure = process.env.SESSION_COOKIE_SECURE === "true" ? true : requestSecure;
  const result = await login(password, { secure, ip: getClientIp(request) });
  if (!result.ok) {
    if (result.blocked) {
      return NextResponse.json(
        { error: "登录失败次数过多，请 15 分钟后再试" },
        { status: 429, headers: { "Retry-After": String(result.retryAfter ?? 900) } },
      );
    }
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
