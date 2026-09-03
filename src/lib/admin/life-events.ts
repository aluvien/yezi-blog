// 生活节点的业务核心。鉴权由调用方（Server Action 或已鉴权 Route Handler）负责。
// 提取是「复制 + 整理 + 建立来源关系」，绝不移动或删除原始絮语。
import { revalidatePath } from "next/cache";
import {
  createLifeEvent,
  deleteLifeEvent,
  getLifeEvent,
  getLifeEventBySourceMoment,
  getMoment,
  updateLifeEvent,
} from "@/lib/db";
import type { LifeEvent } from "@/lib/db";
import type { ActionResult } from "@/lib/actions/posts";
import {
  normalizeLifeDatePrecision,
  parseLifeEventDate,
  type LifeDatePrecision,
} from "@/lib/life-events";
import { normalizeMomentLocation } from "@/lib/moment-location";
import { normalizePostTags } from "@/lib/post-tags";

const MAX_LIFE_TITLE_LENGTH = 240;
const MAX_LIFE_CONTENT_LENGTH = 20_000;

/** 客户端提交的表单形状：日期是自由文本 + 精度选择。 */
export interface LifeEventFormInput {
  title: string;
  content: string;
  occurred_at: string;
  date_precision: string;
  cover: string | null;
  images: string[];
  tags: string[];
  location?: string;
}

function normalizeImages(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 9) return null;
  const images = value.map((item) => String(item ?? "").trim());
  const valid = images.every((image) => {
    if (!image || image.length > 2_000) return false;
    if (image.startsWith("/uploads/") && !image.startsWith("//")) return true;
    try {
      const url = new URL(image);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  });
  return valid ? [...new Set(images)] : null;
}

function normalizeCover(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 2_000) return undefined;
  if (value.startsWith("/uploads/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

function validate(data: LifeEventFormInput): { error: string } | { value: {
  title: string; content: string; occurred_at: string; date_precision: LifeDatePrecision;
  cover: string | null; images: string[]; tags: string[]; location: string;
} } {
  if (!data || typeof data !== "object") return { error: "生活节点数据格式无效" };
  const title = String(data.title ?? "").trim();
  if (!title) return { error: "请填写标题" };
  if (title.length > MAX_LIFE_TITLE_LENGTH) return { error: `标题不能超过 ${MAX_LIFE_TITLE_LENGTH} 个字符` };
  const content = String(data.content ?? "").trim();
  if (content.length > MAX_LIFE_CONTENT_LENGTH) return { error: "内容不能超过 2 万个字符" };
  const precision = normalizeLifeDatePrecision(data.date_precision);
  const parsed = parseLifeEventDate(data.occurred_at, precision);
  if (!parsed) return { error: precision === "year" ? "请填写有效年份，如 2002" : precision === "month" ? "请填写有效年月，如 2025-07" : "请填写有效日期，如 2026-09-03" };
  const images = normalizeImages(data.images);
  if (!images) return { error: "图片地址无效或数量超过 9 张" };
  const cover = normalizeCover(data.cover);
  if (cover === undefined) return { error: "封面地址无效" };
  const location = normalizeMomentLocation(data.location);
  if (location === null) return { error: "位置格式无效或超过 80 个字符" };
  return { value: { title, content, occurred_at: parsed.occurredAt, date_precision: parsed.precision, cover, images, tags: normalizePostTags(data.tags), location } };
}

function revalidateLifePages(): void {
  revalidatePath("/admin/life");
  revalidatePath("/admin/life/milestones");
  revalidatePath("/admin");
  revalidatePath("/life");
}

export async function createLifeEventEntry(data: LifeEventFormInput): Promise<ActionResult> {
  const check = validate(data);
  if ("error" in check) return { ok: false, error: check.error };
  const event = createLifeEvent({ ...check.value, source_type: "manual", source_moment_id: null });
  revalidateLifePages();
  return { ok: true, data: event };
}

export async function updateLifeEventEntry(id: number, data: LifeEventFormInput): Promise<ActionResult> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "生活节点数据格式无效" };
  if (!getLifeEvent(id)) return { ok: false, error: "生活节点不存在" };
  const check = validate(data);
  if ("error" in check) return { ok: false, error: check.error };
  const event = updateLifeEvent(id, check.value);
  revalidateLifePages();
  return { ok: true, data: event };
}

export async function deleteLifeEventEntry(id: number): Promise<ActionResult> {
  if (!getLifeEvent(id)) return { ok: false, error: "生活节点不存在" };
  deleteLifeEvent(id);
  revalidateLifePages();
  return { ok: true, data: { id } };
}

/**
 * 从絮语提取生活节点：加载并校验源絮语存在、尚未被提取，按用户确认后的整理结果创建节点，
 * 记录来源关系。原絮语完全保留。date 由用户在整理界面确认，默认预填絮语时间。
 */
export async function extractLifeEventFromMoment(momentId: number, data: LifeEventFormInput): Promise<ActionResult> {
  if (!Number.isInteger(momentId) || momentId < 1) return { ok: false, error: "絮语不存在" };
  const moment = getMoment(momentId);
  if (!moment) return { ok: false, error: "絮语不存在" };
  if (getLifeEventBySourceMoment(momentId)) return { ok: false, error: "这条絮语已经提取过生活节点了" };
  const check = validate(data);
  if ("error" in check) return { ok: false, error: check.error };
  let event: LifeEvent;
  try {
    event = createLifeEvent({ ...check.value, source_type: "moment", source_moment_id: momentId });
  } catch (error) {
    // 并发下唯一索引兜底；不把内部约束异常抛给页面。
    if (/UNIQUE|constraint/i.test(error instanceof Error ? error.message : String(error))) {
      return { ok: false, error: "这条絮语已经提取过生活节点了" };
    }
    throw error;
  }
  revalidateLifePages();
  return { ok: true, data: event };
}

/** 供提取整理界面预填：读取源絮语并归一化日期/图片/标签为表单初值；原絮语不变。 */
export function getMomentExtractSeed(momentId: number): LifeEventFormInput | null {
  const moment = getMoment(momentId);
  if (!moment) return null;
  let images: string[] = [];
  try {
    const parsed = JSON.parse(moment.images) as unknown;
    if (Array.isArray(parsed)) images = parsed.filter((item): item is string => typeof item === "string").slice(0, 9);
  } catch {
    images = [];
  }
  const occurred_at = moment.created_at.slice(0, 10);
  return {
    title: "",
    content: moment.content,
    occurred_at,
    date_precision: "day",
    cover: null,
    images,
    tags: parseTagsSafe(moment.tags),
    location: moment.location,
  };
}

function parseTagsSafe(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
