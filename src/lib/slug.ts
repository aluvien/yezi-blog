import { pinyin } from "pinyin-pro";

/**
 * 把标题转成 URL 友好的 ASCII slug。中文经 pinyin-pro 转拼音，
 * 只保留小写字母与数字，其余字符折叠为单个连字符。
 * 抽成独立纯模块以便单元测试不触发数据库连接。
 */
export function slugify(title: string): string {
  const romanized = pinyin(title, { toneType: "none", nonZh: "consecutive" });
  return romanized
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}
