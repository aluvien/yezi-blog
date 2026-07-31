import Link from "next/link";
import { listPosts, listMoments, countApprovedComments } from "@/lib/db";
import { PostEntry } from "@/components/site/PostEntry";
import { MomentEntry } from "@/components/site/MomentEntry";
import { CommentSection } from "@/components/site/CommentSection";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 12;

export default async function Home({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const { page } = await searchParams;
  const current = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const posts = listPosts();
  const moments = listMoments();
  const latestMoment = moments[0];
  const latestMomentCommentCount = latestMoment ? countApprovedComments("moment", latestMoment.id) : 0;
  const shownPosts = posts.slice(0, current * PAGE_SIZE);
  const hasMorePosts = posts.length > shownPosts.length;

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <header className="mb-7 flex flex-col gap-5 border-b border-divider pb-7 md:mb-9 md:flex-row md:items-end md:justify-between md:gap-10">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">{site.author}&apos;s blog</p>
          <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.045em] md:text-[42px]">记录正在发生的事。</h1>
        </div>
        <p className="max-w-sm text-[14px] leading-7 text-muted md:pb-1">完整文章写清楚一件事，短想法留住一个瞬间。这里是两种记录自然交汇的地方。</p>
      </header>

      <section className="relative overflow-hidden rounded-3xl border border-accent/15 bg-[#eff9f2] px-5 py-6 md:px-8 md:py-7" aria-labelledby="latest-moment-heading">
        <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent/10 blur-3xl" />
        <div className="relative grid gap-6 md:grid-cols-[180px_1fr] md:gap-10">
          <div className="flex items-start justify-between gap-4 md:block">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Latest note</p>
              <h2 id="latest-moment-heading" className="mt-2 text-[21px] font-semibold tracking-[-0.025em]">最新想法</h2>
            </div>
            <Link href="/moments" className="shrink-0 text-[13px] text-wechat-blue transition-colors hover:text-accent md:mt-5 md:inline-flex">
              查看全部想法 <span aria-hidden="true">→</span>
            </Link>
          </div>

          {!latestMoment ? (
            <p className="self-center text-[14px] text-muted">还没有想法，欢迎稍后再来。</p>
          ) : (
            <div className="border-t border-accent/15 pt-5 md:border-l md:border-t-0 md:pl-8 md:pt-0">
              <MomentEntry
                moment={latestMoment}
                commentCount={latestMomentCommentCount}
                compact
              >
                <CommentSection targetType="moment" targetId={latestMoment.id} />
              </MomentEntry>
            </div>
          )}
        </div>
      </section>

      <section className="mt-11" aria-labelledby="articles-heading">
        <div className="flex items-end justify-between gap-4 border-b border-divider pb-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent">Writing</p>
            <h2 id="articles-heading" className="mt-2 text-[24px] font-semibold tracking-[-0.03em]">文章</h2>
          </div>
          <span className="pb-1 text-[12px] text-muted">{posts.length} 篇</span>
        </div>

        {shownPosts.length === 0 ? (
          <p className="py-16 text-center text-[14px] text-muted">还没有文章，敬请期待。</p>
        ) : (
          <div className="divide-y divide-divider">
            {shownPosts.map((post) => (
              <div key={post.id} className="py-6 md:py-7">
                <PostEntry post={post} commentCount={countApprovedComments("post", post.id)} />
              </div>
            ))}
          </div>
        )}

        {hasMorePosts && (
          <div className="border-t border-divider py-5 text-center">
            <Link href={`/?page=${current + 1}`} className="inline-flex rounded-full border border-neutral-200 px-6 py-2 text-[13px] text-foreground/65 transition-colors hover:border-accent hover:text-accent">
              查看更多文章
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
