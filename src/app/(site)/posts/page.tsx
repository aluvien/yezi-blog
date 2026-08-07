import type { Metadata } from "next";
import Link from "next/link";
import { countApprovedCommentsBulk, countPublishedPosts, getSiteSettings, listPosts } from "@/lib/db";
import { PostEntry } from "@/components/site/PostEntry";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "文章",
  description: "所有长文章，把一件事讲清楚的完整记录。",
};

const PAGE_SIZE = 12;

export default async function PostsPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const current = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  // SQL 分页：取到当前页为止（配合"查看更多"按钮逐页追加），不把全部文章读进内存。
  const total = countPublishedPosts();
  const shown = listPosts({ limit: current * PAGE_SIZE });
  const hasMore = total > shown.length;
  // 后台开关：控制"查看更多文章"按钮是否显示
  const showMore = getSiteSettings().show_more_posts !== "0";
  const isAuthorized = !!(await getSession());
  const commentCounts = countApprovedCommentsBulk("post", shown.map((post) => post.id));

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <div className="site-posts-header site-list-heading mb-7 flex items-center justify-between gap-4 border-b border-divider pb-4">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground">文章</h1>
        <span className="text-sm text-muted">{total} 篇</span>
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-[14px] text-muted">还没有文章，敬请期待。</p>
      ) : (
        <div>
          {shown.map((post) => (
            <div key={post.id} className="py-6 md:py-7">
              <PostEntry post={post} commentCount={commentCounts.get(post.id) ?? 0} canEdit={isAuthorized} />
            </div>
          ))}
        </div>
      )}

      {hasMore && showMore && (
        <div className="border-t border-divider py-5 text-center">
          <Link
            href={`/posts?page=${current + 1}`}
            className="inline-flex rounded-full border border-neutral-200 px-6 py-2 text-[13px] text-foreground/65 transition-colors hover:border-accent hover:text-accent"
          >
            查看更多文章
          </Link>
        </div>
      )}
    </div>
  );
}
