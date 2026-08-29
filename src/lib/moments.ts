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

/**
 * 从想法正文中提取末尾元信息使用的 #标签。
 * 标签采用短文本写法（如“今天去了公园 #散步”），不会把 Markdown 的
 * `# 标题` 误识别为标签；同一标签只展示一次，最多保留 8 个。
 */
export function parseMomentTags(content: string): string[] {
  const tags: string[] = [];
  const seen = new Set<string>();
  const pattern = /(?:^|[\s，。！？,.!?；;：:、])#([\p{L}\p{N}_-]{1,32})/gu;
  for (const match of content.matchAll(pattern)) {
    const tag = match[1]?.trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
    if (tags.length >= 8) break;
  }
  return tags;
}
