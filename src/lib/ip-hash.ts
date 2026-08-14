import crypto from "crypto";

/**
 * 将 IP 哈希为不可逆字符串，用于评论限频与存储，避免明文留存。
 * 抽成独立纯模块（不依赖 next/headers），使 db.ts 能在 Node 单元测试环境加载。
 */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(ip.trim() || "unknown").digest("hex");
}
