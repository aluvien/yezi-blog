import crypto from "crypto";
import { headers } from "next/headers";

/**
 * 获取客户端地址。
 * 只有明确配置 TRUST_PROXY=true 时才读取代理头，避免直连时被客户端伪造。
 */
export function getClientIp(request: Request): string {
  if (process.env.TRUST_PROXY === "true") {
    const realIp = request.headers.get("x-real-ip")?.split(",")[0]?.trim();
    if (realIp) return realIp.slice(0, 100);
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded.slice(0, 100);
  }

  return "unknown";
}

/** 互动去重只保存不可逆 visitor key，不把完整 UA/IP 写入公开统计表。 */
export function getVisitorKey(request: Request): string {
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? "";
  return hashVisitorKey(ip, userAgent);
}

/** 将 IP 哈希为不可逆字符串，用于评论限频与存储，避免明文留存。 */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip.trim() || "unknown").digest("hex");
}

function hashVisitorKey(ip: string, userAgent: string): string {
  return crypto.createHash("sha256").update(`${ip}|${userAgent}`).digest("hex");
}

/**
 * 在 Server Component 内获取 visitor key（基于请求头 IP+UA），
 * 用于 SSR 时查询当前访客是否已点赞，避免 localStorage 与后端不一致。
 */
export async function getVisitorKeyFromRequest(): Promise<string> {
  const headersList = await headers();
  let ip = "";
  if (process.env.TRUST_PROXY === "true") {
    ip = headersList.get("x-real-ip")?.split(",")[0]?.trim() ?? "";
    if (!ip) ip = headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  }
  if (!ip) ip = "unknown";
  ip = ip.slice(0, 100);
  const userAgent = headersList.get("user-agent")?.slice(0, 300) ?? "";
  return hashVisitorKey(ip, userAgent);
}
