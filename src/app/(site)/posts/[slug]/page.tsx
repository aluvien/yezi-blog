import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getContentMetrics, listArticleReferenceSnapshotsForPost, listRelatedPosts, countApprovedComments, hasLiked } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { renderMarkdown, stripMarkdown, extractHeadings } from "@/lib/markdown";
import { getSiteAuthor } from "@/lib/site";
import { getAuthorAvatar } from "@/lib/author";
import { getVisitorKeyFromRequest } from "@/lib/request";
import { CommentSection } from "@/components/site/CommentSection";
import { AuthorCard } from "@/components/site/AuthorCard";
import { ArticleActionBar } from "@/components/site/ArticleActionBar";
import { ArticleImageWrapper } from "@/components/site/ImageLightbox";
import { TableOfContents } from "@/components/site/TableOfContents";
import { RelatedPosts } from "@/components/site/RelatedPosts";
import { parsePostTags } from "@/lib/post-tags";
import { BackToTopButton } from "@/components/site/BackToTopButton";
import { ArticleEditZone } from "@/components/site/ArticleEditZone";
import { getSession } from "@/lib/auth";
import { getCachedPostBySlug, getCachedSiteSettings } from "@/lib/server-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getCachedPostBySlug(slug);
  if (!post) return { title: "文章不存在" };
  const authorName = getSiteAuthor(getCachedSiteSettings());
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
      authors: [authorName],
      ...(post.cover ? { images: [post.cover] } : {}),
    },
  };
}

export default async function PostPage({ params }: Props) {
  const { slug } = await params;
  const post = getCachedPostBySlug(slug);
  if (!post) notFound();

  const html = renderMarkdown(post.content, listArticleReferenceSnapshotsForPost(post.id));
  const headings = extractHeadings(post.content);
  const relatedPosts = listRelatedPosts(post.id, 3);
  const siteSettings = getCachedSiteSettings();
  const authorName = getSiteAuthor(siteSettings);
  const commentCount = countApprovedComments("post", post.id);
  const tags = parsePostTags(post.tags);
  const articleCategory = post.category || tags[0] || "文章";
  const initialMetrics = getContentMetrics("post", post.id);
  const initialLiked = hasLiked("post", post.id, await getVisitorKeyFromRequest());
  const isAuthorized = !!(await getSession());
  return (
    <>
      <ArticleEditZone
        href={`/admin/posts/${post.id}/edit`}
        enabled={isAuthorized}
        zoneClassName="article-edit-zone article-detail-edit-zone"
      >
      <article className="article-shell mx-auto min-h-[70vh] max-w-none pb-6 pt-0 md:pb-8 md:pt-12">
        <header className="mx-auto max-w-[800px]">
          <p className="mb-3 text-[12px] font-medium tracking-[0.12em] text-accent">{articleCategory}</p>
          <h1 className="article-title text-[26px] font-bold leading-[1.35] tracking-[-0.025em] md:text-[30px]">{post.title}</h1>
          <div className="article-meta site-meta mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            <span>{formatDateOnly(post.created_at)}</span>
            <span className="article-author text-divider-strong">·</span>
            <span className="article-author font-medium text-wechat-blue">{authorName}</span>
            <ArticleActionBar commentCount={commentCount} targetId={post.id} initialMetrics={initialMetrics} initialLiked={initialLiked} />
          </div>
        </header>

        <ArticleImageWrapper>
          {/* 目录 */}
          {headings.length > 2 && siteSettings.show_table_of_contents !== "0" && <TableOfContents headings={headings} />}

          {/* 正文 */}
          <div
            className="article-body mx-auto mt-9 max-w-[800px]"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </ArticleImageWrapper>

        {/* 文章标签：显示在正文底部（需求：不显示在顶部） */}
        {tags.length > 0 && (
          <div className="mt-10 mb-6 flex flex-wrap justify-center gap-2">
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

        {/* 作者卡片 */}
        <AuthorCard authorName={authorName} avatar={getAuthorAvatar(siteSettings)} avatarNoBorder={siteSettings.author_avatar_no_border === "1"} />

        {/* 推荐阅读 */}
        {relatedPosts.length > 0 && siteSettings.show_related_posts !== "0" && (
          <div className="mt-10 border-t border-divider pt-8">
            <RelatedPosts posts={relatedPosts} />
          </div>
        )}

        {/* 评论区：标题行带“写评论”按钮（与标题同行，不额外占高），表单默认折叠 */}
        <div id="comments" className="article-comments comments-section mx-auto max-w-[800px]">
          <CommentSection targetType="post" targetId={post.id} commentCount={commentCount} defaultFormCollapsed authorName={authorName} />
        </div>
      </article>
      </ArticleEditZone>

      <BackToTopButton />

    </>
  );
}
