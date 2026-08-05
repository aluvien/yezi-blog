import type { Moment } from "@/lib/db";

/**
 * 解析想法图片 JSON 字符串为路径数组，非法/空返回 []。
 * 纯函数，供前端 client 组件使用（避免把 db 模块拖进浏览器 bundle）。
 */
export function parseMomentImages(moment: Pick<Moment, "images">): string[] {
  try {
    const arr = JSON.parse(moment.images);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
