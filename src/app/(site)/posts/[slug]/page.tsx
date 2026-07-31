import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPostBySlug, listRelatedPosts, countApprovedComments } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { renderMarkdown, stripMarkdown, extractHeadings } from "@/lib/markdown";
import { site } from "@/lib/site";
import { CommentSection } from "@/components/site/CommentSection";
import { ReadingProgress } from "@/components/site/ReadingProgress";
import { AuthorCard } from "@/components/site/AuthorCard";
import { ArticleActionBar } from "@/components/site/ArticleActionBar";
import { ArticleImageWrapper } from "@/components/site/ImageLightbox";
import { TableOfContents } from "@/components/site/TableOfContents";
import { RelatedPosts } from "@/components/site/RelatedPosts";
import { parsePostTags } from "@/lib/post-tags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "文章不存在" };
  const description = stripMarkdown(post.content, 120);
  return {
    title: post.title,
    description,
    openGraph: {
      type: "article",
      title: post.title,
      description,
      publishedTime: post.created_at,
      modifiedTime: post.updated_at,
      authors: [site.author],
      ...(post.cover ? { images: [post.cover] } : {}),
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const html = renderMarkdown(post.content);
  const headings = extractHeadings(post.content);
  const relatedPosts = listRelatedPosts(post.id, 3);
  const commentCount = countApprovedComments("post", post.id);
  const tags = parsePostTags(post.tags);
  return (
    <>
      <ReadingProgress />
      <article className="paper-card min-h-[70vh] px-5 pb-12 pt-8 md:rounded-2xl md:px-12 md:pb-14 md:pt-12">
        <header>
          <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.18em] text-accent">Original article</p>
          <h1 className="text-[26px] font-bold leading-[1.35] tracking-[-0.025em] md:text-[34px]">{post.title}</h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
            <span className="font-medium text-wechat-blue">{site.author}</span>
            <span>{formatDateOnly(post.created_at)}</span>
            <span className="text-neutral-300">·</span>
            <span>发布于 {site.name}</span>
          </div>
          {tags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Link
                  key={tag}
                  href={`/tags/${encodeURIComponent(tag)}`}
                  className="rounded-full bg-accent/10 px-2.5 py-1 text-[12px] text-accent transition-colors hover:bg-accent/15"
                >
                  #{tag}
                </Link>
              ))}
            </div>
          )}
        </header>

        {/* 封面 */}
        {post.cover && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={post.cover} alt={post.title} className="mt-7 aspect-[16/8.5] w-full rounded-lg object-cover" />
        )}

        {/* 目录 */}
        {headings.length > 2 && <TableOfContents headings={headings} />}

        {/* 正文 */}
        <ArticleImageWrapper>
          <div
            className="article-body mt-9"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </ArticleImageWrapper>

        {/* 装饰性文末分隔 */}
        <div className="my-12 text-center text-[13px] tracking-[0.6em] text-neutral-300">• • •</div>

        {/* 作者卡片 */}
        <AuthorCard />

        {/* 推荐阅读 */}
        {relatedPosts.length > 0 && (
          <div className="mt-10 border-t border-divider pt-8">
            <RelatedPosts posts={relatedPosts} />
          </div>
        )}

        {/* 评论区 */}
        <div id="comments" className="mt-10 border-t border-divider pt-8">
          <h2 className="text-[17px] font-semibold">
            {commentCount > 0 ? `${commentCount} 条精选留言` : "写下你的留言"}
          </h2>
          <CommentSection targetType="post" targetId={post.id} />
        </div>
      </article>

      <ArticleActionBar commentCount={commentCount} />
    </>
  );
}
