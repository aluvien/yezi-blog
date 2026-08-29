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
 * 将最多 9 张想法图片分成视觉完整的 1–3 列行，避免最后一行只剩一张。
 * 规则：1 / 2 / 3 / 2+2 / 2+3 / 3+3 / 2+2+3 / 2+3+3 / 3+3+3。
 */
export function groupMomentImages<T>(images: T[]): T[][] {
  const items = images.slice(0, 9);
  const rowSizes: Record<number, number[]> = {
    1: [1],
    2: [2],
    3: [3],
    4: [2, 2],
    5: [2, 3],
    6: [3, 3],
    7: [2, 2, 3],
    8: [2, 3, 3],
    9: [3, 3, 3],
  };
  const groups: T[][] = [];
  let offset = 0;
  for (const size of rowSizes[items.length] || []) {
    groups.push(items.slice(offset, offset + size));
    offset += size;
  }
  return groups;
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
