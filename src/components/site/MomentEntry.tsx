"use client";

import { useState } from "react";
import type { ContentMetrics, Moment } from "@/lib/db";
import { parseMomentImages } from "@/lib/moments";
import { formatDateOnly } from "@/lib/format";
import { site } from "@/lib/site";
import { splitMomentContent } from "@/lib/music";
import { MomentCommentToggle } from "@/components/site/MomentCommentToggle";
import { MetricIcon } from "@/components/site/MetricIcon";
import { MomentImages } from "@/components/site/MomentImages";
import MomentForm from "@/components/admin/MomentForm";
import { useMomentView } from "@/components/site/MomentViewTracker";

/**
 * 想法条目（朋友圈样式）。
 * 评论区由父级传入 children，避免在不需要评论区的列表场景重复加载。
 *
 * canEdit（管理员已登录）时头部右上角显示"编辑"按钮，点击切换到与"写想法"
 * 一致的就地编辑表单（MomentForm compact），保存后回到查看态。
 */
export function MomentEntry({
  moment,
  commentCount,
  metrics,
  authorName,
  authorAvatar,
  authorAvatarNoBorder = false,
  children,
  initialLiked = false,
  canEdit = false,
}: {
  moment: Moment;
  commentCount: number;
  metrics?: ContentMetrics;
  authorName?: string;
  authorAvatar?: string;
  authorAvatarNoBorder?: boolean;
  children?: React.ReactNode;
  initialLiked?: boolean;
  canEdit?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [touchActive, setTouchActive] = useState(false);
  const images = parseMomentImages(moment);
  const segments = splitMomentContent(moment.content);
  const displayAuthor = authorName?.trim() || site.author;
  const avatar = authorAvatar?.trim();
  const { views, targetRef } = useMomentView(moment.id, metrics?.views ?? 0);
  const displayMetrics = metrics ? { ...metrics, views } : undefined;

  // 编辑态：与"写想法"一致的表单，预填该条内容与图片
  if (editing) {
    return (
      <article id={`moment-${moment.id}`} className="moment-entry min-w-0">
        <MomentForm compact moment={moment} onSuccess={() => setEditing(false)} onCancel={() => setEditing(false)} />
      </article>
    );
  }

  return (
    <article
      ref={targetRef}
      id={`moment-${moment.id}`}
      className={`moment-entry min-w-0 ${touchActive ? "is-touch-active" : ""}`}
      onTouchStart={() => setTouchActive(true)}
    >
      <div className="moment-entry-head">
        <div className={`moment-entry-avatar ${avatar ? "has-avatar" : ""} ${authorAvatarNoBorder ? "no-border" : ""}`}>
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
        {canEdit && (
          <button
            type="button"
            className="moment-edit-btn"
            onClick={() => setEditing(true)}
            title="编辑想法"
            aria-label="编辑想法"
          >
            <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
            </svg>
            编辑
          </button>
        )}
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
              data-shuffle={seg.value.shuffle ? "1" : "0"}
            />
          ),
        )}
        <MomentImages images={images} />
      </div>
      {children ? (
        <MomentCommentToggle targetId={moment.id} count={commentCount} metrics={displayMetrics} initialLiked={initialLiked}>
          {children}
        </MomentCommentToggle>
      ) : (
        <div className="moment-entry-meta site-meta flex items-center gap-4 text-muted">
          {displayMetrics && (
            <>
              <span className="inline-flex items-center gap-1"><MetricIcon type="like" />{displayMetrics.likes}</span>
              <span className="inline-flex items-center gap-1"><MetricIcon type="view" />{displayMetrics.views}</span>
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
