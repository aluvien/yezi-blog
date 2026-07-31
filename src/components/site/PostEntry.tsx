import Link from "next/link";
import type { Post } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { stripMarkdown } from "@/lib/markdown";

/** 首页时间线中的文章条目 */
export function PostEntry({ post, commentCount = 0 }: { post: Post; commentCount?: number }) {
  const excerpt = stripMarkdown(post.content, 110);
  return (
    <article>
      <Link href={`/posts/${post.slug}`} className="group block">
        <div className="flex gap-4 md:gap-5">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex items-center gap-2 text-[11px] text-muted">
              <span className="rounded bg-accent/10 px-1.5 py-0.5 font-medium text-accent">文章</span>
              <time>{formatDateOnly(post.created_at)}</time>
              {commentCount > 0 && <><span>·</span><span>{commentCount} 条留言</span></>}
            </div>
            <h2 className="text-[18px] font-semibold leading-snug text-foreground transition-colors group-hover:text-accent md:text-[19px]">
              {post.title}
            </h2>
            {excerpt && (
              <p className="mt-2 line-clamp-2 text-[14px] leading-6 text-muted">{excerpt}</p>
            )}
          </div>
          {post.cover && (
            // 封面为后台上传的本地路径，尺寸不固定，用原生 img
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.cover}
              alt=""
              className="h-22 w-28 shrink-0 rounded-xl object-cover sm:w-32"
            />
          )}
        </div>
      </Link>
    </article>
  );
}
