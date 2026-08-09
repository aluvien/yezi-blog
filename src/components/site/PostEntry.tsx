import Link from "next/link";
import type { Post } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { stripMarkdown } from "@/lib/markdown";
import { parsePostTags } from "@/lib/post-tags";
import { MetricIcon } from "@/components/site/MetricIcon";
import { ArticleEditZone } from "@/components/site/ArticleEditZone";
import { SiteImage } from "@/components/site/SiteImage";

/** 首页时间线中的文章条目 */
export function PostEntry({ post, commentCount = 0, canEdit = false }: { post: Post; commentCount?: number; canEdit?: boolean }) {
  const excerpt = stripMarkdown(post.content, 110);
  const firstTag = parsePostTags(post.tags)[0];
  return (
    <ArticleEditZone
      href={`/admin/posts/${post.id}/edit`}
      enabled={canEdit}
      zoneClassName={`article-edit-zone post-entry-edit-zone ${firstTag ? "has-post-tag" : ""}`}
    >
    <article>
      <Link href={`/posts/${post.slug}`} className="group block">
        <div className="flex gap-4 md:gap-5">
          <div className="min-w-0 flex-1">
            {firstTag && <div className="mb-2 text-[12px] font-medium text-accent">{firstTag}</div>}
            <h2 className="text-[24px] font-semibold leading-[1.3] text-foreground transition-colors group-hover:text-accent">
              {post.title}
            </h2>
            {excerpt && (
              <p className="mt-2 line-clamp-2 text-[14px] leading-6 text-muted">{excerpt}</p>
            )}
            <div className="site-meta mt-3 flex items-center gap-4 text-muted">
              <time>{formatDateOnly(post.created_at)}</time>
              {commentCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <MetricIcon type="comment" />
                  {commentCount}
                </span>
              )}
            </div>
          </div>
          {post.cover && (
            <div className="relative h-22 w-28 shrink-0 overflow-hidden rounded-xl sm:w-32">
              <SiteImage
                src={post.cover}
                alt=""
                fill
                sizes="(max-width: 640px) 112px, 128px"
                className="object-cover"
              />
            </div>
          )}
        </div>
      </Link>
    </article>
    </ArticleEditZone>
  );
}
