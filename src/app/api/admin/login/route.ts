import { NextResponse } from "next/server";
import { login } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let password = "";
  try {
    const body = await request.json();
    password = String(body?.password ?? "");
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }
  if (!process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "服务器未配置 ADMIN_PASSWORD" }, { status: 500 });
  }
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const requestProtocol = forwardedProto ?? new URL(request.url).protocol.replace(":", "");
  const ok = await login(password, { secure: requestProtocol === "https" });
  if (!ok) {
    return NextResponse.json({ error: "密码错误" }, { status: 401 });
  }
  return NextResponse.json({ ok: true });
}
