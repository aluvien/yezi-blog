// 生活节点日期与精度的纯逻辑（不含数据库依赖，可在 client 组件与单测中安全 import）。
//
// 语义：occurred_at 是事情实际发生的时间，created_at 是录入博客的时间，二者不可混用。
// 为了既能按时间正确排序、又能尊重用户填写的精度，occurred_at 统一按最小值补全为
// YYYY-MM-DD 存储：year → 当年 01-01，month → 当月 01 日，day → 原样。展示时再按
// date_precision 还原成 "2002" / "2025-07" / "2026-09-03"，绝不把 "2002" 显示成 "2002-01-01"。

export type LifeDatePrecision = "day" | "month" | "year";

export const LIFE_DATE_PRECISIONS: readonly LifeDatePrecision[] = ["day", "month", "year"];

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_LOCATION_LENGTH = 80;
// 用 RegExp 构造清洗控制字符，避免源码里出现裸控制符。
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

export function normalizeLifeDatePrecision(value: unknown): LifeDatePrecision {
  return value === "year" || value === "month" || value === "day" ? value : "day";
}

function isRealCalendarDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * 解析用户输入并归一化成存储值。输入允许与精度同样的宽松度：
 * "2002" / "2002-07" / "2002-07-15"。返回 null 表示非法，调用方据此拒绝写入。
 */
export function parseLifeEventDate(
  raw: unknown,
  precision: LifeDatePrecision,
): { occurredAt: string; precision: LifeDatePrecision } | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  const match = value.match(/^(\d{4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?$/);
  if (!match) return null;
  const year = Number(match[1]);
  if (!Number.isInteger(year) || year < 1 || year > 9999) return null;

  if (precision === "year") {
    if (match[2] !== undefined && Number(match[2]) !== 1) return null;
    if (match[3] !== undefined) return null;
    return { occurredAt: `${match[1]}-01-01`, precision };
  }

  const month = match[2] === undefined ? NaN : Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  if (precision === "month") {
    if (match[3] !== undefined && Number(match[3]) !== 1) return null;
    return { occurredAt: `${match[1]}-${pad2(month)}-01`, precision };
  }

  const day = match[3] === undefined ? NaN : Number(match[3]);
  if (!Number.isInteger(day) || day < 1 || day > 31) return null;
  if (!isRealCalendarDay(year, month, day)) return null;
  return { occurredAt: `${match[1]}-${pad2(month)}-${pad2(day)}`, precision };
}

/** 校验已存在的存储值（如 API/数据库读回）；非法返回 false。 */
export function isValidLifeEventDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  return isRealCalendarDay(Number(match[1]), Number(match[2]), Number(match[3]));
}

/** 按精度展示；同时用于前台时间轴与后台列表，保证两端一致。 */
export function formatLifeEventDate(occurredAt: string, precision: LifeDatePrecision): string {
  const match = DATE_PATTERN.exec(occurredAt);
  if (!match) return occurredAt;
  const [, year, month, day] = match;
  if (precision === "year") return year;
  if (precision === "month") return `${year}-${month}`;
  return `${year}-${month}-${day}`;
}

/** 从 occurredAt 取年份，供时间轴按年聚段。 */
export function lifeEventYear(occurredAt: string): string {
  return occurredAt.slice(0, 4);
}

/** 把图片 JSON 字符串解析成字符串数组（非法/空返回 []）。纯函数，供 client 复用。 */
export function parseLifeEventImages(raw: string | null | undefined): string[] {
  try {
    const value = JSON.parse(String(raw ?? "[]")) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 生活节点位置：只保留可展示的短文字，去除控制字符并限长；非法返回 null。 */
export function normalizeLifeEventLocation(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") return null;
  const location = value.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return location.length <= MAX_LOCATION_LENGTH ? location : null;
}
