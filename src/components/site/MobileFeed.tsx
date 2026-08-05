import Link from "next/link";
import type { ContentMetrics, Moment, Post } from "@/lib/db";
import { parseMomentImages } from "@/lib/moments";
import { formatDateOnly } from "@/lib/format";
import { stripMarkdown } from "@/lib/markdown";
import { MetricIcon, type MetricIconType } from "@/components/site/MetricIcon";
import { MomentImages } from "@/components/site/MomentImages";
import { LikeButton } from "@/components/site/LikeButton";
import { splitMomentContent } from "@/lib/music";

export type FeedItem =
  | { type: "moment"; value: Moment; commentCount: number; metrics: ContentMetrics; initialLiked: boolean }
  | { type: "post"; value: Post; commentCount: number; metrics: ContentMetrics; initialLiked: boolean };

function Metric({ type, value, href }: { type: MetricIconType; value: number; href?: string }) {
  const content = <><MetricIcon type={type} /><span>{value}</span></>;
  if (href) return <Link href={href} className="mobile-feed-metric">{content}</Link>;
  return <span className="mobile-feed-metric">{content}</span>;
}

function MobileMemo({ moment, commentCount, metrics, authorName, authorAvatar, initialLiked }: { moment: Moment; commentCount: number; metrics: ContentMetrics; authorName: string; authorAvatar?: string; initialLiked: boolean }) {
  const images = parseMomentImages(moment);
  const segments = splitMomentContent(moment.content);
  return (
    <article className="mobile-feed-memo">
      <div className="mobile-feed-memo-head">
        <div className="mobile-feed-avatar">
          {authorAvatar ? (
            // 头像支持后台设置的本地上传路径或外部 URL。
            // eslint-disable-next-line @next/next/no-img-element
            <img src={authorAvatar} alt="" />
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
            <div key={index} className="blog-music" data-server={seg.value.server} data-id={seg.value.id} data-type={seg.value.type} />
          ),
        )}
        {images.length > 0 && <MomentImages images={images} />}
      </div>
      <div className="mobile-feed-meta">
        <LikeButton targetType="moment" targetId={moment.id} initialLikes={metrics.likes} initialLiked={initialLiked} />
        <Metric type="view" value={metrics.views} />
        <span className="mobile-feed-meta-spacer" />
        <Metric type="comment" value={commentCount} href={`/moments#moment-${moment.id}`} />
      </div>
    </article>
  );
}

function MobilePost({ post, commentCount, metrics, initialLiked }: { post: Post; commentCount: number; metrics: ContentMetrics; initialLiked: boolean }) {
  const excerpt = stripMarkdown(post.content, 120);
  return (
    <article className="mobile-feed-post">
      {post.cover ? (
        <Link href={`/posts/${post.slug}`} className="mobile-feed-post-banner">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={post.cover} alt="" loading="lazy" />
          <span>{post.title}</span>
        </Link>
      ) : (
        <>
          {post.category && <div className="mobile-feed-post-kicker">
            <Link href={`/categories/${encodeURIComponent(post.category)}`}>{post.category}</Link>
          </div>}
          <h2 className="mobile-feed-post-title"><Link href={`/posts/${post.slug}`}>{post.title}</Link></h2>
          {excerpt && <p className="mobile-feed-post-excerpt">{excerpt}</p>}
        </>
      )}
      <div className="mobile-feed-meta mobile-feed-post-meta">
        <time>{formatDateOnly(post.created_at)}</time>
        <span className="mobile-feed-meta-spacer" />
        <LikeButton targetType="post" targetId={post.id} initialLikes={metrics.likes} initialLiked={initialLiked} />
        <Metric type="view" value={metrics.views} />
        <Metric type="comment" value={commentCount} href={`/posts/${post.slug}#comments`} />
      </div>
    </article>
  );
}

export function MobileFeed({ items, authorName = "", authorAvatar }: { items: FeedItem[]; authorName?: string; authorAvatar?: string }) {
  return (
    <div className="mobile-feed">
      {items.map((item) => item.type === "moment" ? (
        <MobileMemo key={`moment-${item.value.id}`} moment={item.value} commentCount={item.commentCount} metrics={item.metrics} authorName={authorName} authorAvatar={authorAvatar} initialLiked={item.initialLiked} />
      ) : (
        <MobilePost key={`post-${item.value.id}`} post={item.value} commentCount={item.commentCount} metrics={item.metrics} initialLiked={item.initialLiked} />
      ))}
      <p className="mobile-feed-end">继续向下浏览更早的记录</p>
    </div>
  );
}
