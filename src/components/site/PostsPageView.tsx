import Link from "next/link";
import { countApprovedCommentsBulk, countPublishedPosts, listPosts } from "@/lib/db";
import { PostEntry } from "@/components/site/PostEntry";
import { getSession } from "@/lib/auth";
import { getCachedSiteSettings } from "@/lib/server-data";
import { formatDateOnly } from "@/lib/format";
import { parsePostTags } from "@/lib/post-tags";
import { stripMarkdown } from "@/lib/markdown";
import { ClassicEntrySearch } from "@/components/site/ClassicEntrySearch";

export async function PostsPageView({ searchParams, classic = false }: { searchParams: Promise<{ page?: string }>; classic?: boolean }) {
  const { page } = await searchParams;
  const current = Math.max(1, Number.parseInt(page ?? "1", 10) || 1);
  const total = countPublishedPosts();
  const shown = listPosts({ limit: current * 12 });
  const hasMore = total > shown.length;
  const showMore = getCachedSiteSettings().show_more_posts !== "0";
  const isAuthorized = !!(await getSession());
  const commentCounts = countApprovedCommentsBulk("post", shown.map((post) => post.id));

  if (classic) {
    return (
      <>
        <div className="entry-filters" data-entry-filters>
          <div className="page-header page-header--essay page-header--with-search">
            <div className="page-heading">
              <div className="page-title-row"><h1 className="page-title">随笔</h1></div>
              <span className="page-subtitle page-subtitle--entry-filters">
                <span className="page-subtitle__text">随笔与杂记 · 共 {total} 篇</span>
                <Link className="page-subtitle__link page-subtitle__item" href="/essay/rss.xml">RSS</Link>
              </span>
            </div>
            <div className="page-actions"><ClassicEntrySearch label="随笔" /></div>
          </div>
        </div>
        {shown.length === 0 ? <p>还没有文章，敬请期待。</p> : (
          <div className="list" id="classic-entry-list">
            {shown.map((post) => {
              const excerpt = stripMarkdown(post.content, 160);
              const tags = parsePostTags(post.tags || post.category || "").slice(0, 3);
              const category = post.category?.trim() || "随笔";
              const wasUpdated = formatDateOnly(post.updated_at) !== formatDateOnly(post.created_at);
              return (
                <Link className="list-item list-item--link classic-entry-card" href={`/archive/${post.slug}`} data-entry-item data-search={`${post.title} ${excerpt} ${tags.join(" ")}`} key={post.id}>
                  <div className="list-item__row">
                    <div className="list-item__title-group">
                      <span className="badge">{category}</span>
                      <h2 className="list-item__title">{post.title}</h2>
                    </div>
                  </div>
                  {excerpt ? <p className="list-item__excerpt">{excerpt}</p> : null}
                  <div className="meta-line meta-line--items">
                    <span className="meta-line__item">
                      <time dateTime={post.created_at}>{wasUpdated ? "更新于：" : "发布于："}{formatDateOnly(wasUpdated ? post.updated_at : post.created_at)}</time>
                    </span>
                    {tags.length > 0 ? <span className="meta-line__item meta-line__item--tags">{tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</span> : null}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
        {hasMore && showMore ? <nav className="pagination" aria-label="随笔分页"><div className="pagination__inner"><Link className="pagination__link pagination__link--next" href={`/essay?page=${current + 1}`}>下一页</Link></div></nav> : null}
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <div className="site-posts-header site-list-heading mb-7 flex items-center justify-between gap-4 border-b border-divider pb-4">
        <h1 className="text-xl font-semibold tracking-[-0.02em] text-foreground">{classic ? "随笔" : "文章"}</h1>
        <span className="text-sm text-muted">{total} 篇</span>
      </div>

      {shown.length === 0 ? (
        <p className="py-16 text-center text-[14px] text-muted">还没有文章，敬请期待。</p>
      ) : (
        <div>
          {shown.map((post) => (
            <div key={post.id} className="site-list-entry py-6 md:py-7">
              <PostEntry post={post} commentCount={commentCounts.get(post.id) ?? 0} canEdit={isAuthorized} hrefBase={classic ? "/archive" : "/posts"} />
            </div>
          ))}
        </div>
      )}

      {hasMore && showMore && (
        <div className="border-t border-divider py-5 text-center">
          <Link href={`${classic ? "/essay" : "/posts"}?page=${current + 1}`} className="inline-flex rounded-full border border-divider px-6 py-2 text-[13px] text-foreground/65 transition-colors hover:border-accent hover:text-accent">
            查看更多文章
          </Link>
        </div>
      )}
    </div>
  );
}
