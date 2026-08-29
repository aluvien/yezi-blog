import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { countApprovedCommentsBulk, listPostsByTag } from "@/lib/db";
import { PostEntry } from "@/components/site/PostEntry";
import { getSession } from "@/lib/auth";
import { getCachedSiteSettings } from "@/lib/server-data";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ tag: string }> };

function decodeTag(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tag = decodeTag((await params).tag);
  return { title: `标签：${tag}`, alternates: { canonical: PUBLIC_ROUTES.tag(tag) } };
}

export default async function TagPage({ params }: Props) {
  const tag = decodeTag((await params).tag);
  if (!tag) notFound();
  const posts = listPostsByTag(tag);
  const classic = getCachedSiteSettings().layout_theme === "classic";
  const isAuthorized = !!(await getSession());
  const commentCounts = countApprovedCommentsBulk("post", posts.map((post) => post.id));

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <Link href={PUBLIC_ROUTES.posts} className="text-[13px] text-wechat-blue transition-colors hover:text-accent">← 返回{classic ? "随笔" : "文章"}</Link>
      <header className="mt-8 border-b border-divider pb-7">
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-accent">Tag archive</p>
        <h1 className="mt-3 text-[30px] font-semibold tracking-[-0.04em] md:text-[40px]">#{tag}</h1>
        <p className="mt-3 text-[14px] text-muted">共 {posts.length} 篇文章</p>
      </header>

      {posts.length === 0 ? (
        <p className="py-16 text-center text-[14px] text-muted">这个标签下暂时没有文章。</p>
      ) : (
        <div>
          {posts.map((post) => (
            <div key={post.id} className="py-6 md:py-7">
              <PostEntry post={post} commentCount={commentCounts.get(post.id) ?? 0} canEdit={isAuthorized} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
