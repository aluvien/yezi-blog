/** 将后台输入的逗号分隔标签规范化并去重。 */
export function normalizePostTags(input: string | string[] | null | undefined): string[] {
  const values = Array.isArray(input) ? input : String(input ?? "").split(/[,，\n]/);
  return [...new Set(
    values
      .map((tag) => String(tag).trim().replace(/^#+/, ""))
      .map((tag) => tag.slice(0, 80).trim())
      .filter(Boolean),
  )].slice(0, 12);
}

/** 兼容迁移前没有 tags 字段或旧格式的文章。 */
export function parsePostTags(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizePostTags(parsed);
  } catch {
    // 旧数据若不是 JSON，按逗号分隔文本兜底。
  }
  return normalizePostTags(raw);
}
