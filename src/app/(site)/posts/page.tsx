import type { Metadata } from "next";
import { PostsPageView } from "@/components/site/PostsPageView";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";
import { countPublishedPosts } from "@/lib/db";
import { parsePostPage, POSTS_PAGE_SIZE } from "@/lib/post-pagination";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ searchParams }: { searchParams: Promise<{ page?: string }> }): Promise<Metadata> {
  const page = parsePostPage((await searchParams).page);
  const pages = Math.max(1, Math.ceil(countPublishedPosts() / POSTS_PAGE_SIZE));
  return {
    title: page === 1 ? "文章" : `文章 · 第 ${page} 页`,
    description: "所有长文章，把一件事讲清楚的完整记录。",
    alternates: { canonical: page === 1 ? PUBLIC_ROUTES.posts : `${PUBLIC_ROUTES.posts}?page=${page}` },
    robots: { index: page <= pages, follow: true },
  };
}

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return <PostsPageView searchParams={searchParams} />;
}
