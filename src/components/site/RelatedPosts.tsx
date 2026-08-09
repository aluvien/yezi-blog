import Link from "next/link";
import type { Post } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { SiteImage } from "@/components/site/SiteImage";

export function RelatedPosts({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[14px] font-semibold text-foreground">继续阅读</h3>
        <span className="text-[11px] text-muted">相关文章</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {posts.map((post) => (
          <Link
            key={post.id}
            href={`/posts/${post.slug}`}
            className="group flex items-start gap-2.5 rounded-lg border border-divider p-2.5 transition-colors hover:border-accent/40"
          >
            {post.cover && (
              <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded">
                <SiteImage src={post.cover} alt="" fill sizes="56px" className="object-cover" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium leading-snug text-foreground transition-colors group-hover:text-accent line-clamp-2">
                {post.title}
              </div>
              <div className="site-meta site-meta-compact mt-1 text-muted">
                {formatDateOnly(post.created_at)}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
