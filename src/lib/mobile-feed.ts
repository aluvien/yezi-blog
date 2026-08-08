import type { Post } from "@/lib/db";

export type PostSummary = Pick<Post, "id" | "title" | "slug" | "cover" | "category" | "created_at"> & {
  excerpt: string;
};

export function toPostSummary(post: Post, excerpt: string): PostSummary {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    cover: post.cover,
    category: post.category,
    created_at: post.created_at,
    excerpt,
  };
}
