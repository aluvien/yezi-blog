"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { attachAttachmentsToPost, createPost, deletePost, getPost, normalizePostTags, syncArticleReferences, updatePost } from "@/lib/db";
import { compactArticleReferenceMarkers, parseArticleReferenceMarkers, type ArticleReferenceSnapshot } from "@/lib/article-reference";

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

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function createPostAction(data: PostInput): Promise<ActionResult> {
  await requireAdmin();
  if (!data.title.trim()) return { ok: false, error: "请填写标题" };
  if (data.status === "published" && !data.content.trim()) return { ok: false, error: "发布文章前请填写正文" };
  const referenceSnapshots = data.referenceSnapshots ?? [];
  const content = compactArticleReferenceMarkers(data.content, referenceSnapshots);
  const created = createPost({
    title: data.title.trim(),
    slug: data.slug,
    content,
    cover: data.cover,
    category: data.category,
    tags: normalizePostTags(data.tags),
    status: data.status,
  });
  attachAttachmentsToPost(data.attachmentIds, created.id);
  syncArticleReferences(created.id, parseArticleReferenceMarkers(content, referenceSnapshots));
  revalidatePath("/admin/posts");
  revalidatePath("/admin/attachments");
  revalidatePath("/");
  revalidatePath("/archives");
  revalidatePath(`/categories/${encodeURIComponent(data.category)}`);
  revalidatePath("/rss.xml");
  revalidatePath("/sitemap.xml");
  return { ok: true };
}

export async function updatePostAction(id: number, data: PostInput): Promise<ActionResult> {
  await requireAdmin();
  const existing = getPost(id);
  if (!existing) return { ok: false, error: "文章不存在" };
  if (!data.title.trim()) return { ok: false, error: "请填写标题" };
  if (data.status === "published" && !data.content.trim()) return { ok: false, error: "发布文章前请填写正文" };
  const referenceSnapshots = data.referenceSnapshots ?? [];
  const content = compactArticleReferenceMarkers(data.content, referenceSnapshots);
  const updated = updatePost(id, {
    title: data.title.trim(),
    slug: data.slug,
    content,
    cover: data.cover,
    category: data.category,
    tags: normalizePostTags(data.tags),
    status: data.status,
  });
  attachAttachmentsToPost(data.attachmentIds, id);
  syncArticleReferences(id, parseArticleReferenceMarkers(content, referenceSnapshots));
  revalidatePath("/admin/posts");
  revalidatePath("/admin/attachments");
  revalidatePath("/");
  revalidatePath("/archives");
  revalidatePath(`/categories/${encodeURIComponent(data.category)}`);
  revalidatePath(`/posts/${existing.slug}`);
  revalidatePath(`/posts/${updated?.slug || existing.slug}`);
  revalidatePath("/rss.xml");
  revalidatePath("/sitemap.xml");
  return { ok: true };
}

export async function deletePostAction(id: number): Promise<ActionResult> {
  await requireAdmin();
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
  return { ok: true };
}
