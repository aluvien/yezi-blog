import type { Metadata } from "next";
import Link from "next/link";
import { listPostSummaries } from "@/lib/db";
import { getSiteAuthor } from "@/lib/site";
import { getAuthorAvatar } from "@/lib/author";
import { getVisitorKeyFromRequest } from "@/lib/request";
import { MobileFeed, type FeedItem } from "@/components/site/MobileFeed";
import { PostEntry } from "@/components/site/PostEntry";
import { MomentEntry } from "@/components/site/MomentEntry";
import { CommentSection } from "@/components/site/CommentSection";
import { PageHeader } from "@/components/site/PageHeader";
import { getSession } from "@/lib/auth";
import { getHomeFeedPage } from "@/lib/home-feed";
import { toPostSummary } from "@/lib/mobile-feed";
import { getCachedPublishedTags, getCachedSiteSettings } from "@/lib/server-data";
import { ClassicArchiveList } from "@/components/site/ClassicHome";
import { ClassicEntrySearch } from "@/components/site/ClassicEntrySearch";
import { ClassicEntryTags } from "@/components/site/ClassicEntryTags";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "归档", description: "按时间浏览所有文章与絮语。", alternates: { canonical: PUBLIC_ROUTES.archives } };

const ARCHIVE_PAGE_SIZE = 12;

type SearchParams = { page?: string | string[] };

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function pageParam(value: string | string[] | undefined): number {
  const parsed = Number.parseInt(firstParam(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 10_000) : 1;
}

function archivePageHref(page: number): string {
  return page <= 1 ? PUBLIC_ROUTES.archives : `${PUBLIC_ROUTES.archives}?page=${page}`;
}

function ArchivePager({ page, hasMore }: { page: number; hasMore: boolean }) {
  if (page <= 1 && !hasMore) return null;
  return (
    <nav className="mt-10 flex items-center justify-between text-sm" aria-label="归档分页">
      {page > 1
        ? <Link href={archivePageHref(page - 1)} className="rounded-full bg-soft px-4 py-2 text-muted no-underline transition-colors hover:text-foreground">← 上一页</Link>
        : <span className="px-4 py-2 text-muted/40">← 上一页</span>}
      <span className="text-xs text-muted tabular-nums">第 {page} 页</span>
      {hasMore
        ? <Link href={archivePageHref(page + 1)} className="rounded-full bg-soft px-4 py-2 text-muted no-underline transition-colors hover:text-foreground">下一页 →</Link>
        : <span className="px-4 py-2 text-muted/40">下一页 →</span>}
    </nav>
  );
}

export default async function ArchivesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const archiveTags = getCachedPublishedTags(100);
  const siteSettings = getCachedSiteSettings();
  const authorName = getSiteAuthor(siteSettings);

  // The classic archive has a browser-side search index, so retain all article
  // rows but use the summary projection instead of loading full Markdown bodies.
  if (siteSettings.layout_theme === "classic") {
    const posts = listPostSummaries();
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

  const page = pageParam(params.page);
  const isAuthorized = !!(await getSession());
  const visitorKey = await getVisitorKeyFromRequest();
  // The shared feed query selects one page and hydrates metrics/comments for
  // those IDs, instead of reading and sorting the entire archive in JS.
  const archivePage = getHomeFeedPage({ offset: (page - 1) * ARCHIVE_PAGE_SIZE, limit: ARCHIVE_PAGE_SIZE, visitorKey });
  const items = archivePage.items;

  return <>
    <div className="mobile-home-page md:hidden">
      <MobileFeed items={items} authorName={authorName} authorAvatar={getAuthorAvatar(siteSettings) || undefined} authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"} canEdit={isAuthorized} />
      <ArchivePager page={page} hasMore={archivePage.hasMore} />
    </div>
    <div className="mx-auto hidden max-w-[860px] py-8 md:block md:py-12">
      <PageHeader eyebrow="时间线" title="归档" description="文章与絮语按时间自然排列，方便从头浏览。" trailing={`第 ${page} 页`} />
      <div>
        {items.map((item) => item.type === "post" ? (
          <div key={`post-${item.value.id}`} className="py-6"><PostEntry post={item.value} commentCount={item.commentCount} canEdit={isAuthorized} /></div>
        ) : (
          <div key={`moment-${item.value.id}`} className="py-6"><MomentEntry moment={item.value} commentCount={item.commentCount} metrics={item.metrics} authorName={authorName} authorAvatar={getAuthorAvatar(siteSettings) || undefined} authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"} initialLiked={item.initialLiked} canEdit={isAuthorized}><CommentSection targetType="moment" targetId={item.value.id} authorName={authorName} /></MomentEntry></div>
        ))}
      </div>
      <ArchivePager page={page} hasMore={archivePage.hasMore} />
    </div>
  </>;
}
