"use server";

import { requireAdmin } from "@/lib/auth";
import {
  attachArticleReferenceToPost,
  createPostEntry,
  deletePostEntry,
  saveReferenceLibraryEntry,
  updatePostEntry,
} from "@/lib/admin/posts";
import type { ArticleReferenceSnapshot } from "@/lib/article-reference";
import { generateTitleSlug } from "@/lib/slug-translation";

export interface PostInput {
  title: string;
  slug: string;
  content: string;
  cover: string | null;
  category: string;
  tags: string;
  attachmentIds: number[];
  referenceSnapshots?: ArticleReferenceSnapshot[];
  status: "draft" | "published";
}

export type ActionResult = { ok: true; message?: string; data?: unknown } | { ok: false; error: string };

export type GeneratePostSlugResult =
  | { ok: true; slug: string; source: "llm" | "fallback" }
  | { ok: false; error: string };

/** Server Action 入口：只做 Cookie 会话鉴权，业务逻辑在 @/lib/admin/posts。 */

export async function createPostAction(data: PostInput): Promise<ActionResult> {
  await requireAdmin();
  return createPostEntry(data);
}

export async function updatePostAction(id: number, data: PostInput): Promise<ActionResult> {
  await requireAdmin();
  return updatePostEntry(id, data);
}

/** 管理员手动生成文章 slug；与保存时的自动生成共用同一套 LLM/本地兜底逻辑。 */
export async function generatePostSlugAction(title: string): Promise<GeneratePostSlugResult> {
  await requireAdmin();
  const source = typeof title === "string" ? title.trim() : "";
  if (!source) return { ok: false, error: "请先填写文章标题" };
  const generated = await generateTitleSlug(source);
  if (!generated) return { ok: false, error: "无法生成有效 Slug，请手动填写" };
  return { ok: true, slug: generated.slug, source: generated.source };
}

export async function deletePostAction(id: number): Promise<ActionResult> {
  await requireAdmin();
  return deletePostEntry(id);
}

/** 从引用管理页把引用直接附加到已有文章，避免为了插入引用跳去“新建文章”。 */
export async function attachArticleReferenceToPostAction(postId: number, input: ArticleReferenceSnapshot): Promise<ActionResult> {
  await requireAdmin();
  return attachArticleReferenceToPost(postId, input);
}

/** 将站外文章保存到独立引用资料库；无需先关联本地文章。 */
export async function saveReferenceLibraryAction(input: ArticleReferenceSnapshot, category = "", tags = ""): Promise<ActionResult> {
  await requireAdmin();
  return saveReferenceLibraryEntry(input, category, tags);
}
