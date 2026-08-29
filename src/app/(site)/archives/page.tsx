import type { Metadata } from "next";
import Link from "next/link";
import { countApprovedCommentsBulk, getContentMetricsBulk, hasLikedBulk } from "@/lib/db";
import { getSiteAuthor } from "@/lib/site";
import { getAuthorAvatar } from "@/lib/author";
import { getVisitorKeyFromRequest } from "@/lib/request";
import { MobileFeed, type FeedItem } from "@/components/site/MobileFeed";
import { PostEntry } from "@/components/site/PostEntry";
import { MomentEntry } from "@/components/site/MomentEntry";
import { CommentSection } from "@/components/site/CommentSection";
import { PageHeader } from "@/components/site/PageHeader";
import { getSession } from "@/lib/auth";
import { stripMarkdown } from "@/lib/markdown";
import { toPostSummary } from "@/lib/mobile-feed";
import { getCachedMoments, getCachedPublishedPosts, getCachedPublishedTags, getCachedSiteSettings } from "@/lib/server-data";
import { ClassicArchiveList } from "@/components/site/ClassicHome";
import { ClassicEntrySearch } from "@/components/site/ClassicEntrySearch";
import { ClassicEntryTags } from "@/components/site/ClassicEntryTags";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "归档", description: "按时间浏览所有文章与想法。", alternates: { canonical: PUBLIC_ROUTES.archives } };

export default async function ArchivesPage() {
  const posts = getCachedPublishedPosts();
  const archiveTags = getCachedPublishedTags(100);
  const siteSettings = getCachedSiteSettings();
  const authorName = getSiteAuthor(siteSettings);

  // The classic archive only renders article title/date/tags. Avoid loading
  // interaction counters and comment state that this view never displays.
  if (siteSettings.layout_theme === "classic") {
    const emptyMetrics = { views: 0, likes: 0 };
    const classicItems: FeedItem[] = posts.map((post) => ({
      type: "post" as const,
      value: toPostSummary(post, ""),
      commentCount: 0,
      metrics: emptyMetrics,
      initialLiked: false,
    }));
    return (
      <>
        <div className="entry-filters" data-entry-filters>
          <div className="page-header page-header--with-search">
            <div className="page-heading">
              <div className="page-title-row"><h1 className="page-title">归档</h1></div>
              <span className="page-subtitle page-subtitle--entry-filters"><span className="page-subtitle__text">共 {posts.length} 篇内容</span><Link className="page-subtitle__link page-subtitle__item" href={PUBLIC_ROUTES.rss}>RSS</Link><ClassicEntryTags tags={archiveTags} /></span>
            </div>
            <div className="page-actions"><ClassicEntrySearch label="归档" /></div>
          </div>
        </div>
        <div id="classic-entry-list"><ClassicArchiveList items={classicItems} /></div>
      </>
    );
  }

  const moments = getCachedMoments();
  const isAuthorized = !!(await getSession());
  const visitorKey = await getVisitorKeyFromRequest();
  const postIds = posts.map((post) => post.id);
  const momentIds = moments.map((moment) => moment.id);
  const postCommentCounts = countApprovedCommentsBulk("post", postIds);
  const momentCommentCounts = countApprovedCommentsBulk("moment", momentIds);
  const postMetrics = getContentMetricsBulk("post", postIds);
  const momentMetrics = getContentMetricsBulk("moment", momentIds);
  const postLiked = hasLikedBulk("post", postIds, visitorKey);
  const momentLiked = hasLikedBulk("moment", momentIds, visitorKey);
  const emptyMetrics = { views: 0, likes: 0 };
  const items = [
    ...posts.map((post) => ({
      type: "post" as const,
      value: post,
      commentCount: postCommentCounts.get(post.id) ?? 0,
      metrics: postMetrics.get(post.id) ?? emptyMetrics,
      initialLiked: postLiked.get(post.id) ?? false,
    })),
    ...moments.map((moment) => ({
      type: "moment" as const,
      value: moment,
      commentCount: momentCommentCounts.get(moment.id) ?? 0,
      metrics: momentMetrics.get(moment.id) ?? emptyMetrics,
      initialLiked: momentLiked.get(moment.id) ?? false,
    })),
  ].sort((a, b) => new Date(b.value.created_at).getTime() - new Date(a.value.created_at).getTime());
  const mobileItems: FeedItem[] = items.map((item) => item.type === "post"
    ? {
        ...item,
        value: toPostSummary(item.value, stripMarkdown(item.value.content, 120)),
      }
    : item);

  // 移动端（MobileFeed）与桌面端列表是两套布局，用 CSS 显隐各渲染一份：
  // 代价是 moment 的 CommentSection 会被 SSR 两次。对个人博客数据量可接受，
  // 保持现状以维持两端各自独立、清晰的视觉与交互；若未来需要优化再合并为单一响应式组件。
  return <>
    <div className="mobile-home-page md:hidden"><MobileFeed items={mobileItems} authorName={authorName} authorAvatar={getAuthorAvatar(siteSettings) || undefined} authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"} canEdit={isAuthorized} /></div>
    <div className="mx-auto hidden max-w-[860px] py-8 md:block md:py-12">
      <PageHeader eyebrow="时间线" title="归档" description="文章与想法按时间自然排列，方便从头浏览。" trailing={`${items.length} 条记录`} />
      <div>
        {items.map((item) => item.type === "post" ? (
          <div key={`post-${item.value.id}`} className="py-6"><PostEntry post={item.value} commentCount={item.commentCount} canEdit={isAuthorized} /></div>
        ) : (
          <div key={`moment-${item.value.id}`} className="py-6"><MomentEntry moment={item.value} commentCount={item.commentCount} metrics={item.metrics} authorName={authorName} authorAvatar={getAuthorAvatar(siteSettings) || undefined} authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"} initialLiked={item.initialLiked} canEdit={isAuthorized}><CommentSection targetType="moment" targetId={item.value.id} authorName={authorName} /></MomentEntry></div>
        ))}
      </div>
    </div>
  </>;
}
