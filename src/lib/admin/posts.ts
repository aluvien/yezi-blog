import { revalidatePath } from "next/cache";
import {
  attachAttachmentsToPost,
  createPost,
  db,
  deletePost,
  getPost,
  listArticleReferenceSnapshotsForPost,
  normalizePostTags,
  syncArticleReferences,
  updatePost,
  upsertReferenceLibrarySnapshot,
} from "@/lib/db";
import {
  compactArticleReferenceMarkers,
  encodeArticleReferenceMarker,
  normalizeArticleReferenceSnapshot,
  parseArticleReferenceMarkers,
  type ArticleReferenceSnapshot,
} from "@/lib/article-reference";
import { invalidateQQMusicAccessCache } from "@/lib/qq-music-access";
import { normalizeMediaShortcodes } from "@/lib/media-shortcodes";
import { translateTitleToEnglishSlug } from "@/lib/slug-translation";
import type { ActionResult, PostInput } from "@/lib/actions/posts";

/**
 * 文章与引用快照的业务核心。鉴权由调用方（Server Action 或已鉴权 Route Handler）负责。
 */

const MAX_POST_CONTENT_LENGTH = 1_500_000;
const MAX_REFERENCE_SNAPSHOTS = 50;

function validOptionalAsset(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  const raw = String(value).trim();
  if (!raw || raw.length > 2_000) return false;
  if (raw.startsWith("/uploads/") && !raw.startsWith("//")) return true;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function validatePostInput(data: PostInput): string | null {
  if (!data || typeof data !== "object") return "文章数据无效";
  if (
    typeof data.title !== "string"
    || typeof data.slug !== "string"
    || typeof data.content !== "string"
    || typeof data.category !== "string"
    || typeof data.tags !== "string"
    || !(data.cover === null || typeof data.cover === "string")
  ) return "文章数据格式无效";
  const title = String(data.title ?? "").trim();
  if (!title) return "请填写标题";
  if (title.length > 240) return "标题不能超过 240 个字符";
  if (String(data.slug ?? "").length > 160) return "Slug 不能超过 160 个字符";
  if (String(data.content ?? "").length > MAX_POST_CONTENT_LENGTH) return "文章正文过长，请控制在 150 万字符以内";
  if (String(data.category ?? "").trim().length > 80) return "分类名称不能超过 80 个字符";
  if (data.status !== "draft" && data.status !== "published") return "文章状态无效";
  if (data.status === "published" && !String(data.content ?? "").trim()) return "发布文章前请填写正文";
  if (!validOptionalAsset(data.cover)) return "封面地址无效";
  if (!Array.isArray(data.attachmentIds) || data.attachmentIds.length > 100 || data.attachmentIds.some((id) => !Number.isInteger(id) || id < 1)) {
    return "附件数据无效或数量过多";
  }
  if (data.referenceSnapshots !== undefined && (!Array.isArray(data.referenceSnapshots) || data.referenceSnapshots.length > MAX_REFERENCE_SNAPSHOTS)) {
    return "文章引用不能超过 50 条";
  }
  return null;
}

function writeError(error: unknown): ActionResult {
  console.error("[post-action] 保存文章失败", error instanceof Error ? error.message : error);
  return { ok: false, error: "保存失败，数据未被部分写入，请稍后重试" };
}

export async function createPostEntry(data: PostInput): Promise<ActionResult> {
  const validationError = validatePostInput(data);
  if (validationError) return { ok: false, error: validationError };
  const referenceSnapshots = data.referenceSnapshots ?? [];
  const content = normalizeMediaShortcodes(compactArticleReferenceMarkers(data.content, referenceSnapshots));
  const generatedSlug = data.slug.trim() || await translateTitleToEnglishSlug(data.title);
  let createdPost: ReturnType<typeof getPost>;
  try {
    db.transaction(() => {
      const created = createPost({
        title: data.title.trim(),
        slug: generatedSlug || undefined,
        content,
        cover: data.cover,
        category: data.category,
        tags: normalizePostTags(data.tags),
        status: data.status,
      });
      createdPost = created;
      attachAttachmentsToPost(data.attachmentIds, created.id);
      syncArticleReferences(created.id, parseArticleReferenceMarkers(content, referenceSnapshots));
    })();
  } catch (error) {
    return writeError(error);
  }
  revalidatePath("/admin/posts");
  revalidatePath("/admin/attachments");
  revalidatePath("/");
  revalidatePath("/archives");
  if (data.category.trim()) revalidatePath(`/categories/${encodeURIComponent(data.category.trim())}`);
  revalidatePath("/rss.xml");
  revalidatePath("/sitemap.xml");
  invalidateQQMusicAccessCache();
  return { ok: true, data: createdPost };
}

export async function updatePostEntry(id: number, data: PostInput): Promise<ActionResult> {
  if (!Number.isInteger(id) || id < 1) return { ok: false, error: "文章不存在" };
  const existing = getPost(id);
  if (!existing) return { ok: false, error: "文章不存在" };
  const validationError = validatePostInput(data);
  if (validationError) return { ok: false, error: validationError };
  const referenceSnapshots = data.referenceSnapshots ?? [];
  const content = normalizeMediaShortcodes(compactArticleReferenceMarkers(data.content, referenceSnapshots));
  const generatedSlug = data.slug.trim() || await translateTitleToEnglishSlug(data.title);
  let updatedSlug = existing.slug;
  let updatedPost: ReturnType<typeof getPost>;
  try {
    db.transaction(() => {
      const updated = updatePost(id, {
        title: data.title.trim(),
        slug: generatedSlug || undefined,
        content,
        cover: data.cover,
        category: data.category,
        tags: normalizePostTags(data.tags),
        status: data.status,
      });
      updatedPost = updated;
      updatedSlug = updated?.slug || existing.slug;
      attachAttachmentsToPost(data.attachmentIds, id);
      syncArticleReferences(id, parseArticleReferenceMarkers(content, referenceSnapshots));
    })();
  } catch (error) {
    return writeError(error);
  }
  revalidatePath("/admin/posts");
  revalidatePath("/admin/attachments");
  revalidatePath("/");
  revalidatePath("/archives");
  if (data.category.trim()) revalidatePath(`/categories/${encodeURIComponent(data.category.trim())}`);
  revalidatePath(`/posts/${existing.slug}`);
  revalidatePath(`/posts/${updatedSlug}`);
  revalidatePath("/rss.xml");
  revalidatePath("/sitemap.xml");
  invalidateQQMusicAccessCache();
  return { ok: true, data: updatedPost };
}

export async function deletePostEntry(id: number): Promise<ActionResult> {
  const post = getPost(id);
  if (!post) return { ok: false, error: "文章不存在" };
  deletePost(id);
  revalidatePath("/admin/posts");
  revalidatePath("/admin/attachments");
  revalidatePath("/");
  revalidatePath("/archives");
  revalidatePath(`/posts/${post.slug}`);
  revalidatePath("/rss.xml");
  revalidatePath("/sitemap.xml");
  invalidateQQMusicAccessCache();
  return { ok: true, data: { id: post.id } };
}

/** 从引用管理页把引用直接附加到已有文章，避免为了插入引用跳去“新建文章”。 */
export async function attachArticleReferenceToPost(postId: number, input: ArticleReferenceSnapshot): Promise<ActionResult> {
  if (!Number.isInteger(postId) || postId < 1) return { ok: false, error: "请选择一篇存在的文章" };
  const post = getPost(postId);
  if (!post) return { ok: false, error: "请选择一篇存在的文章" };

  const snapshot = normalizeArticleReferenceSnapshot(input);
  if (!snapshot.url) return { ok: false, error: "引用网址无效" };
  const existingSnapshots = listArticleReferenceSnapshotsForPost(post.id);
  let content = normalizeMediaShortcodes(compactArticleReferenceMarkers(post.content, [...existingSnapshots, snapshot]));
  const currentSnapshots = parseArticleReferenceMarkers(content, [...existingSnapshots, snapshot]);
  const key = snapshot.canonicalUrl || snapshot.url;
  if (!currentSnapshots.some((item) => (item.canonicalUrl || item.url) === key)) {
    content = `${content.trimEnd()}${content.trimEnd() ? "\n\n" : ""}${encodeArticleReferenceMarker(snapshot)}\n`;
  }
  const nextSnapshots = [
    ...parseArticleReferenceMarkers(content, [...existingSnapshots, snapshot]).filter((item) => (item.canonicalUrl || item.url) !== key),
    snapshot,
  ];
  const compactedContent = normalizeMediaShortcodes(compactArticleReferenceMarkers(content, nextSnapshots));
  if (compactedContent.length > MAX_POST_CONTENT_LENGTH || nextSnapshots.length > MAX_REFERENCE_SNAPSHOTS) {
    return { ok: false, error: "文章正文或引用数量已达到上限" };
  }
  try {
    db.transaction(() => {
      updatePost(post.id, {
        title: post.title,
        slug: post.slug,
        content: compactedContent,
        cover: post.cover,
        category: post.category,
        tags: normalizePostTags(post.tags),
        status: post.status,
      });
      syncArticleReferences(post.id, parseArticleReferenceMarkers(compactedContent, nextSnapshots));
    })();
  } catch (error) {
    return writeError(error);
  }
  revalidatePath("/admin/references");
  revalidatePath(`/admin/posts/${post.id}/edit`);
  revalidatePath("/admin/posts");
  revalidatePath(`/posts/${post.slug}`);
  revalidatePath("/");
  revalidatePath("/archives");
  return { ok: true, message: `已添加到《${post.title}》` };
}

/** 将站外文章保存到独立引用资料库；无需先关联本地文章。 */
export async function saveReferenceLibraryEntry(input: ArticleReferenceSnapshot, category = "", tags = ""): Promise<ActionResult> {
  const snapshot = normalizeArticleReferenceSnapshot(input);
  if (!snapshot.url) return { ok: false, error: "引用网址无效" };
  const normalizedCategory = String(category ?? "").trim();
  if (normalizedCategory.length > 80) return { ok: false, error: "分类名称不能超过 80 个字符" };
  const saved = upsertReferenceLibrarySnapshot(snapshot, { category: normalizedCategory, tags });
  revalidatePath("/admin/references");
  revalidatePath("/references");
  revalidatePath("/admin");
  return { ok: true, message: "已保存到引用资料库", data: saved };
}
