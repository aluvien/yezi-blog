import { PostsPageView } from "@/components/site/PostsPageView";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata = {
  title: "随笔",
  description: "把一件事讲清楚的完整记录。",
};

export default function EssayPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  return <PostsPageView searchParams={searchParams} classic />;
}
