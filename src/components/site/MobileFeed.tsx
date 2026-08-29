"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ContentMetrics, Moment } from "@/lib/db";
import { parseMomentImages } from "@/lib/moments";
import { formatDateOnly } from "@/lib/format";
import type { FeedItem, PostSummary } from "@/lib/mobile-feed";
import { MetricIcon, type MetricIconType } from "@/components/site/MetricIcon";
import { MomentImages } from "@/components/site/MomentImages";
import { LikeButton } from "@/components/site/LikeButton";
import { splitMomentContent } from "@/lib/music";
import { MusicEmbed } from "@/components/site/MusicEmbed";
import { useMomentView } from "@/components/site/MomentViewTracker";
import { ArticleEditZone } from "@/components/site/ArticleEditZone";
import { SiteImage } from "@/components/site/SiteImage";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export type { FeedItem } from "@/lib/mobile-feed";

function Metric({ type, value, href }: { type: MetricIconType; value: number; href?: string }) {
  const content = <><MetricIcon type={type} /><span>{value}</span></>;
  if (href) return <Link href={href} className="mobile-feed-metric">{content}</Link>;
  return <span className="mobile-feed-metric">{content}</span>;
}

function MobileMemo({ moment, commentCount, metrics, authorName, authorAvatar, authorAvatarNoBorder, initialLiked, canEdit }: { moment: Moment; commentCount: number; metrics: ContentMetrics; authorName: string; authorAvatar?: string; authorAvatarNoBorder: boolean; initialLiked: boolean; canEdit: boolean }) {
  const images = parseMomentImages(moment);
  const segments = splitMomentContent(moment.content);
  const { views, targetRef } = useMomentView(moment.id, metrics.views);
  return (
    <ArticleEditZone
      href={`/admin/moments/${moment.id}/edit`}
      enabled={canEdit}
      zoneClassName="mobile-feed-edit-zone"
      buttonClassName="mobile-feed-edit-btn"
      label="编辑想法"
    >
    <article ref={targetRef} className="mobile-feed-memo">
      <div className="mobile-feed-memo-head">
        <div className={`mobile-feed-avatar ${authorAvatar ? "has-avatar" : ""} ${authorAvatarNoBorder ? "no-border" : ""}`}>
          {authorAvatar ? (
            <SiteImage src={authorAvatar} alt="" fill sizes="40px" className="object-cover" />
          ) : (
            <span>{authorName.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="mobile-feed-memo-author">
          <strong>{authorName}</strong>
          <time>{formatDateOnly(moment.created_at)}</time>
        </div>
      </div>
      <div className="mobile-feed-memo-content">
        {segments.map((seg, index) =>
          seg.kind === "text" ? (
            <p key={index}>{seg.value}</p>
          ) : (
            <MusicEmbed key={index} spec={seg.value} />
          ),
        )}
        {images.length > 0 && <MomentImages images={images} />}
      </div>
      <div className="mobile-feed-meta">
        <LikeButton targetType="moment" targetId={moment.id} initialLikes={metrics.likes} initialLiked={initialLiked} />
        <Metric type="view" value={views} />
        <span className="mobile-feed-meta-spacer" />
        <Metric type="comment" value={commentCount} href={PUBLIC_ROUTES.moment(moment.id)} />
      </div>
    </article>
    </ArticleEditZone>
  );
}

function MobilePost({ post, commentCount, metrics, initialLiked, canEdit }: { post: PostSummary; commentCount: number; metrics: ContentMetrics; initialLiked: boolean; canEdit: boolean }) {
  const excerpt = post.excerpt;
  return (
    <ArticleEditZone
      href={`/admin/posts/${post.id}/edit`}
      enabled={canEdit}
      zoneClassName="mobile-feed-edit-zone"
      buttonClassName="mobile-feed-edit-btn"
    >
    <article className="mobile-feed-post">
      {post.cover ? (
        <>
          <Link href={PUBLIC_ROUTES.post(post.slug)} className="mobile-feed-post-banner">
            <SiteImage src={post.cover} alt="" fill sizes="(max-width: 640px) 100vw, 620px" className="object-cover" />
            <span>{post.title}</span>
          </Link>
          {excerpt && <p className="mobile-feed-post-excerpt">{excerpt}</p>}
        </>
      ) : (
        <>
          {post.category && <div className="mobile-feed-post-kicker">
            <Link href={PUBLIC_ROUTES.category(post.category)}>{post.category}</Link>
          </div>}
          <h2 className="mobile-feed-post-title"><Link href={PUBLIC_ROUTES.post(post.slug)}>{post.title}</Link></h2>
          {excerpt && <p className="mobile-feed-post-excerpt">{excerpt}</p>}
        </>
      )}
      <div className="mobile-feed-meta mobile-feed-post-meta">
        <time>{formatDateOnly(post.created_at)}</time>
        <span className="mobile-feed-meta-spacer" />
        <LikeButton targetType="post" targetId={post.id} initialLikes={metrics.likes} initialLiked={initialLiked} />
        <Metric type="view" value={metrics.views} />
        <Metric type="comment" value={commentCount} href={PUBLIC_ROUTES.postComments(post.slug)} />
      </div>
    </article>
    </ArticleEditZone>
  );
}

type FeedPagination = {
  initialHasMore: boolean;
  batchSize: number;
};

type HomeFeedResponse = {
  items?: FeedItem[];
  hasMore?: boolean;
};

export function MobileFeed({ items, authorName = "", authorAvatar, authorAvatarNoBorder = false, canEdit = false, pagination }: { items: FeedItem[]; authorName?: string; authorAvatar?: string; authorAvatarNoBorder?: boolean; canEdit?: boolean; pagination?: FeedPagination }) {
  const isPaginated = Boolean(pagination);
  const [loadedItems, setLoadedItems] = useState(items);
  const [hasMore, setHasMore] = useState(pagination?.initialHasMore ?? false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState("");
  const sentinelRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);
  const batchSize = pagination?.batchSize ?? 5;

  const loadMore = useCallback(async (retry = false) => {
    if (!isPaginated || !hasMore || loadingRef.current || (loadError && !retry)) return;
    loadingRef.current = true;
    setLoadingMore(true);
    setLoadError("");
    try {
      const response = await fetch(`/api/home-feed?offset=${loadedItems.length}&limit=${batchSize}`, { cache: "no-store", credentials: "same-origin" });
      const payload = await response.json().catch(() => null) as HomeFeedResponse | null;
      if (!response.ok || !payload || !Array.isArray(payload.items) || typeof payload.hasMore !== "boolean") throw new Error("加载失败");
      setLoadedItems((current) => {
        const known = new Set(current.map((item) => `${item.type}:${item.value.id}`));
        const additions = payload.items!.filter((item) => !known.has(`${item.type}:${item.value.id}`));
        return additions.length > 0 ? [...current, ...additions] : current;
      });
      setHasMore(payload.hasMore);
    } catch {
      setLoadError("加载较早记录失败");
    } finally {
      loadingRef.current = false;
      setLoadingMore(false);
    }
  }, [batchSize, hasMore, isPaginated, loadError, loadedItems.length]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!isPaginated || !target || !hasMore || loadError) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    }, { rootMargin: "420px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [hasMore, isPaginated, loadError, loadMore]);

  const displayedItems = isPaginated ? loadedItems : items;
  return (
    <div className="mobile-feed">
      {displayedItems.map((item) => item.type === "moment" ? (
        <MobileMemo key={`moment-${item.value.id}`} moment={item.value} commentCount={item.commentCount} metrics={item.metrics} authorName={authorName} authorAvatar={authorAvatar} authorAvatarNoBorder={authorAvatarNoBorder} initialLiked={item.initialLiked} canEdit={canEdit} />
      ) : (
        <MobilePost key={`post-${item.value.id}`} post={item.value} commentCount={item.commentCount} metrics={item.metrics} initialLiked={item.initialLiked} canEdit={canEdit} />
      ))}
      {isPaginated ? (
        <div ref={sentinelRef} className="mobile-feed-end" role="status">
          {loadingMore ? "正在加载更早的记录…" : loadError ? (
            <button type="button" onClick={() => void loadMore(true)} className="mobile-feed-retry">加载失败，点击重试</button>
          ) : hasMore ? "继续向下浏览更早的记录" : "已经到底了"}
        </div>
      ) : <p className="mobile-feed-end">继续向下浏览更早的记录</p>}
    </div>
  );
}
