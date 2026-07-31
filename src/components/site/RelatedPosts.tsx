import Link from "next/link";
import type { Post } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";

export function RelatedPosts({ posts }: { posts: Post[] }) {
  if (posts.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="mb-4 flex items-center justify-between"><h3 className="text-[16px] font-semibold text-foreground">继续阅读</h3><span className="text-[10px] uppercase tracking-[0.16em] text-muted">More stories</span></div>
      {posts.map((post) => (
        <Link
          key={post.id}
          href={`/posts/${post.slug}`}
          className="group -mx-3 flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-neutral-50"
        >
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-medium leading-snug text-foreground group-hover:text-accent transition-colors line-clamp-1">
              {post.title}
            </div>
            <div className="mt-1 text-[12px] text-muted">
              {formatDateOnly(post.created_at)}
            </div>
          </div>
          {post.cover && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.cover}
              alt=""
              className="h-14 w-20 shrink-0 rounded object-cover"
            />
          )}
        </Link>
      ))}
    </div>
  );
}
