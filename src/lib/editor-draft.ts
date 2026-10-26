import { normalizeMomentImageCrops, type MomentImageCrops } from "./moment-image-crops";

export type EditorDraft = { version: 1; savedAt: string; baseline: string; value: string };
const LIMIT = 2 * 1024 * 1024;
export function readEditorDraft(storage: Pick<Storage, "getItem">, key: string): EditorDraft | null {
  const raw = storage.getItem(key);
  if (!raw || raw.length > LIMIT) return null;
  try {
    const item = JSON.parse(raw) as EditorDraft;
    if (item.version !== 1 || !Number.isFinite(Date.parse(item.savedAt)) || typeof item.baseline !== "string" || typeof item.value !== "string") return null;
    JSON.parse(item.value);
    return item;
  } catch { return null; }
}
export function writeEditorDraft(storage: Pick<Storage, "setItem" | "removeItem">, key: string, baseline: string, value: string): string | null {
  if (value === baseline) { storage.removeItem(key); return null; }
  const savedAt = new Date().toISOString();
  const draft: EditorDraft = { version: 1, savedAt, baseline, value };
  const raw = JSON.stringify(draft);
  if (raw.length > LIMIT) throw new Error("草稿内容过大，请及时保存到网站");
  storage.setItem(key, raw);
  return savedAt;
}

type ObjectValue = Record<string, unknown>;
function record(value: unknown): value is ObjectValue { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === "string"); }
export type MomentEditorDraft = { content: string; tags: string; images: string[]; location: string; imageCrops?: MomentImageCrops };
export function isMomentEditorDraft(value: unknown): value is MomentEditorDraft {
  return record(value) && typeof value.content === "string" && typeof value.tags === "string" && strings(value.images) && typeof value.location === "string"
    && (value.imageCrops === undefined || normalizeMomentImageCrops(value.imageCrops, value.images) !== null);
}
export type PostEditorDraft = {
  seoDescription?: string; seoNoindex?: boolean;
  title: string; slug: string; category: string; tags: string; content: string; cover: string | null; status: "draft" | "published";
  attachments: import("@/lib/db/types").Attachment[]; referenceSnapshots: import("@/lib/article-reference").ArticleReferenceSnapshot[];
};
export function isPostEditorDraft(value: unknown): value is PostEditorDraft {
  return record(value) && ["title", "slug", "category", "tags", "content"].every(key => typeof value[key] === "string")
    && (value.seoDescription === undefined || (typeof value.seoDescription === "string" && value.seoDescription.length <= 300))
    && (value.seoNoindex === undefined || typeof value.seoNoindex === "boolean")
    && (value.cover === null || typeof value.cover === "string") && (value.status === "draft" || value.status === "published")
    && Array.isArray(value.attachments) && value.attachments.every(item => record(item) && Number.isSafeInteger(item.id) && Number.isFinite(item.size) && ["path", "original_name", "mime_type", "created_at"].every(key => typeof item[key] === "string"))
    && Array.isArray(value.referenceSnapshots) && value.referenceSnapshots.every(item => record(item) && ["url", "canonicalUrl", "title", "source", "author", "publishedAt", "cover", "description", "summary"].every(key => typeof item[key] === "string") && strings(item.keyPoints));
}
