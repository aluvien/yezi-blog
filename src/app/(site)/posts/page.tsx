import type { Metadata } from "next";
import { PostsPageView } from "@/components/site/PostsPageView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "文章",
  description: "所有长文章，把一件事讲清楚的完整记录。",
};

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return <PostsPageView searchParams={searchParams} />;
}
