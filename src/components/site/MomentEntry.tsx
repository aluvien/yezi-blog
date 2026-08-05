import type { ContentMetrics, Moment } from "@/lib/db";
import { parseMomentImages } from "@/lib/db";
import { formatDateOnly } from "@/lib/format";
import { site } from "@/lib/site";
import { splitMomentContent } from "@/lib/music";
import { MomentCommentToggle } from "@/components/site/MomentCommentToggle";
import { MetricIcon } from "@/components/site/MetricIcon";
import { MomentImages } from "@/components/site/MomentImages";

/**
 * 想法条目（朋友圈样式）。
 * 评论区由父级传入 children，避免在不需要评论区的列表场景重复加载。
 */
export function MomentEntry({
  moment,
  commentCount,
  metrics,
  authorName,
  authorAvatar,
  children,
  initialLiked = false,
}: {
  moment: Moment;
  commentCount: number;
  metrics?: ContentMetrics;
  authorName?: string;
  authorAvatar?: string;
  children?: React.ReactNode;
  initialLiked?: boolean;
}) {
  const images = parseMomentImages(moment);
  const segments = splitMomentContent(moment.content);
  const displayAuthor = authorName?.trim() || site.author;
  const avatar = authorAvatar?.trim();
  return (
    <article id={`moment-${moment.id}`} className="moment-entry min-w-0">
      <div className="moment-entry-head">
        <div className="moment-entry-avatar">
          {avatar ? (
            // 头像支持后台设置的本地上传路径或外部 URL。
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatar} alt="" />
          ) : (
            <span>{displayAuthor.charAt(0).toUpperCase()}</span>
          )}
        </div>
        <div className="moment-entry-author">
          <strong>{displayAuthor}</strong>
          <time>{formatDateOnly(moment.created_at)}</time>
        </div>
      </div>
      <div className="moment-entry-content">
        {segments.map((seg, index) =>
          seg.kind === "text" ? (
            <p key={index} className="whitespace-pre-wrap text-[16px] leading-[1.65] text-foreground">
              {seg.value}
            </p>
          ) : (
            <div
              key={index}
              className="blog-music"
              data-server={seg.value.server}
              data-id={seg.value.id}
              data-type={seg.value.type}
            />
          ),
        )}
        <MomentImages images={images} />
      </div>
      {children ? (
        <MomentCommentToggle targetId={moment.id} count={commentCount} metrics={metrics} initialLiked={initialLiked}>
          {children}
        </MomentCommentToggle>
      ) : (
        <div className="moment-entry-meta site-meta flex items-center gap-4 text-muted">
          {metrics && (
            <>
              <span className="inline-flex items-center gap-1"><MetricIcon type="like" />{metrics.likes}</span>
              <span className="inline-flex items-center gap-1"><MetricIcon type="view" />{metrics.views}</span>
            </>
          )}
          <span className="site-meta-spacer" aria-hidden="true" />
          <span className="inline-flex items-center gap-1">
            <MetricIcon type="comment" />
            {commentCount}
          </span>
        </div>
      )}
    </article>
  );
}
