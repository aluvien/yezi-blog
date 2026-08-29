"use client";

import { useMemo, useState } from "react";
import type { Moment } from "@/lib/db";
import { parseMomentImages, parseMomentTags } from "@/lib/moments";
import { splitMomentContent } from "@/lib/music";
import { formatDate } from "@/lib/format";
import { parsePostTags } from "@/lib/post-tags";
import { MusicEmbed } from "@/components/site/MusicEmbed";
import { LightboxOverlay } from "@/components/site/ImageLightbox";
import { SiteImage } from "@/components/site/SiteImage";

export function ClassicBitsList({ moments, authorName, authorAvatar, commentCounts = {}, commentSections = [], showInteractions = true, showComments = true }: { moments: Moment[]; authorName: string; authorAvatar?: string; commentCounts?: Record<string, number>; commentSections?: React.ReactNode[]; showInteractions?: boolean; showComments?: boolean }) {
  return (
    <div id="bits-list">
      {moments.map((moment, index) => <ClassicBitCard key={moment.id} moment={moment} authorName={authorName} authorAvatar={authorAvatar} prioritize={index === 0} commentCount={commentCounts[String(moment.id)] ?? 0} commentSection={commentSections[index]} showInteractions={showInteractions} showComments={showComments} />)}
    </div>
  );
}

function ClassicBitCard({ moment, authorName, authorAvatar, prioritize, commentCount, commentSection, showInteractions, showComments }: { moment: Moment; authorName: string; authorAvatar?: string; prioritize: boolean; commentCount: number; commentSection?: React.ReactNode; showInteractions: boolean; showComments: boolean }) {
  const images = useMemo(() => parseMomentImages(moment).slice(0, 9), [moment]);
  const tags = useMemo(() => {
    const stored = parsePostTags(moment.tags);
    return stored.length > 0 ? stored : parseMomentTags(moment.content);
  }, [moment.content, moment.tags]);
  const segments = useMemo(() => splitMomentContent(moment.content), [moment.content]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  return (
    <article className="bit-card classic-bit-card" id={`moment-${moment.id}`} data-bit data-bit-key={moment.id} data-year={moment.created_at.slice(0, 4)}>
      <div className="bit-author">
        <div className={`avatar${authorAvatar ? " avatar--image" : " is-fallback"}`} aria-hidden="true">
          {authorAvatar ? <SiteImage src={authorAvatar} alt="" fill sizes="32px" priority={prioritize} /> : null}
          <span className="avatar-fallback">{authorName.charAt(0).toUpperCase()}</span>
        </div>
        <div className="name"><strong>{authorName}</strong></div>
      </div>
      <div className="bit-body">
        {segments.map((segment, index) => segment.kind === "music" ? <MusicEmbed key={index} spec={segment.value} /> : <p key={index}>{segment.value}</p>)}
      </div>
      {images.length > 0 ? (
        <div className={`bit-media ${images.length === 1 ? "bit-media--single" : "bit-media--grid"}`}>
          {images.length === 1 ? (
            <button type="button" className="bit-media-item bit-media-item--single" onClick={() => setLightboxIndex(0)} aria-label="查看图片预览"><SiteImage src={images[0]} alt="" width={800} height={600} priority={prioritize} /></button>
          ) : (
            <div className="bit-media-grid">{images.map((src, index) => <button key={`${src}-${index}`} type="button" className="bit-media-item" onClick={() => setLightboxIndex(index)} aria-label={`图片 ${index + 1}`}><SiteImage src={src} alt="" fill sizes="(max-width: 640px) 45vw, 360px" priority={prioritize && index === 0} /></button>)}</div>
          )}
        </div>
      ) : null}
      <div className="bit-meta">
        {tags.length > 0 ? (
          <div className="bit-tags" aria-label="想法标签">
            <span className="bit-tag bit-tag--normal">
              <span className="bit-tag-icon" aria-hidden="true">❤</span>
              <span className="bit-tag-list">{tags.map((tag) => <span className="bit-tag-token" key={tag}>#{tag}</span>)}</span>
            </span>
          </div>
        ) : null}
        <time className="classic-bit-card__date" dateTime={moment.created_at}>{formatDate(moment.created_at)}</time>
        {showInteractions && showComments ? <div className="classic-bit-card__meta-actions">
          <button type="button" className="classic-bit-card__comment" onClick={() => setCommentsOpen((value) => !value)} aria-expanded={commentsOpen} aria-label={commentCount > 0 ? `查看 ${commentCount} 条评论` : "写下评论"}>评论{commentCount > 0 ? ` ${commentCount}` : ""}</button>
        </div> : null}
      </div>
      {showComments && commentsOpen && commentSection ? <div className="classic-bit-comments">{commentSection}</div> : null}
      {lightboxIndex !== null ? <LightboxOverlay images={images.map((src) => ({ src, alt: "" }))} index={lightboxIndex} onIndexChange={setLightboxIndex} onClose={() => setLightboxIndex(null)} /> : null}
    </article>
  );
}
