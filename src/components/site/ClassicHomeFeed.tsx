"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { FeedItem } from "@/lib/mobile-feed";
import { formatDateOnly } from "@/lib/format";
import { groupMomentImages, parseMomentImages } from "@/lib/moments";
import { parsePostTags } from "@/lib/post-tags";
import { splitMomentContent } from "@/lib/music";
import { MusicEmbed } from "@/components/site/MusicEmbed";
import { LightboxOverlay } from "@/components/site/ImageLightbox";
import { SiteImage } from "@/components/site/SiteImage";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

function PostCard({ item }: { item: Extract<FeedItem, { type: "post" }> }) {
  const post = item.value;
  const tags = parsePostTags(post.category || "").slice(0, 3);

  return (
    <Link href={PUBLIC_ROUTES.post(post.slug)} className="list-item list-item--link classic-entry-card classic-home-feed__post">
      <div className="list-item__row">
        <div className="list-item__title-group">
          <h3 className="list-item__title">{post.title}</h3>
        </div>
      </div>
      {post.excerpt ? <p className="list-item__excerpt">{post.excerpt}</p> : null}
      <div className="meta-line meta-line--items">
        <span className="meta-line__item"><time dateTime={post.created_at}>发布于：{formatDateOnly(post.created_at)}</time></span>
        {tags.length > 0 ? <span className="meta-line__item meta-line__item--tags">{tags.map((tag) => <span className="tag" key={tag}>#{tag}</span>)}</span> : null}
      </div>
    </Link>
  );
}

function MomentCard({ item, authorName, authorAvatar }: { item: Extract<FeedItem, { type: "moment" }>; authorName: string; authorAvatar?: string }) {
  const moment = item.value;
  const router = useRouter();
  const images = useMemo(() => parseMomentImages(moment).slice(0, 9), [moment]);
  const imageGroups = useMemo(() => groupMomentImages(images), [images]);
  const segments = useMemo(() => splitMomentContent(moment.content).filter((segment) => segment.kind !== "music" || !segment.value.folded), [moment.content]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const destination = PUBLIC_ROUTES.moment(moment.id);

  function openMoment(event: React.MouseEvent<HTMLElement>) {
    const target = event.target;
    if (target instanceof Element && target.closest("a,button,input,textarea,select,.blog-music,.bit-media")) return;
    router.push(destination);
  }

  function openMomentFromKeyboard(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    router.push(destination);
  }

  return (
    <article className="bit-card classic-home-feed__bit" id={`moment-${moment.id}`} role="link" tabIndex={0} aria-label={`查看絮语：${formatDateOnly(moment.created_at)}`} onClick={openMoment} onKeyDown={openMomentFromKeyboard}>
      <div className="classic-home-feed__bit-copy">
        <div className="bit-author">
          <div className={`avatar${authorAvatar ? " avatar--image" : " is-fallback"}`} aria-hidden="true">
            {authorAvatar ? <SiteImage src={authorAvatar} alt="" fill sizes="32px" /> : null}
            <span className="avatar-fallback">{authorName.charAt(0).toUpperCase()}</span>
          </div>
          <div className="name">
            <strong>{authorName}</strong>
            <time dateTime={moment.created_at}>{formatDateOnly(moment.created_at)}</time>
          </div>
        </div>
        <div className="bit-body">
          {segments.map((segment, index) => segment.kind === "music" ? <MusicEmbed key={index} spec={segment.value} /> : <p key={index}>{segment.value}</p>)}
        </div>
        {images.length > 0 ? (
          <div className={`bit-media ${images.length === 1 ? "bit-media--single" : "bit-media--grid"}`}>
            {images.length === 1 ? (
              <button type="button" className="bit-media-item bit-media-item--single" onClick={() => setLightboxIndex(0)} aria-label="查看图片预览"><SiteImage src={images[0]} alt="" width={800} height={600} /></button>
            ) : (
              <div className="bit-media-grid bit-media-grid--balanced">{imageGroups.flatMap((row, rowIndex) => {
                const startIndex = imageGroups.slice(0, rowIndex).reduce((sum, group) => sum + group.length, 0);
                return row.map((src, columnIndex) => {
                  const imageIndex = startIndex + columnIndex;
                  return <button key={`${src}-${imageIndex}`} type="button" className={`bit-media-item ${row.length === 3 ? "bit-media-item--third" : "bit-media-item--half"}`} onClick={() => setLightboxIndex(imageIndex)} aria-label={`图片 ${imageIndex + 1}`}><SiteImage src={src} alt="" fill sizes="(max-width: 640px) 33vw, 320px" /></button>;
                });
              })}</div>
            )}
          </div>
        ) : null}
      </div>
      {lightboxIndex !== null ? <LightboxOverlay images={images.map((src) => ({ src, alt: "" }))} index={lightboxIndex} onIndexChange={setLightboxIndex} onClose={() => setLightboxIndex(null)} /> : null}
    </article>
  );
}

export function ClassicHomeFeed({ items, authorName, authorAvatar }: { items: FeedItem[]; authorName: string; authorAvatar?: string }) {
  return (
    <div className="classic-home-feed">
      {items.map((item) => item.type === "post"
        ? <PostCard key={`post-${item.value.id}`} item={item} />
        : <MomentCard key={`moment-${item.value.id}`} item={item} authorName={authorName} authorAvatar={authorAvatar} />)}
    </div>
  );
}
