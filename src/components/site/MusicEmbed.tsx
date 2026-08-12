"use client";

/* eslint-disable @next/next/no-img-element -- QQ cover URLs are external dynamic assets. */

import { useEffect, useRef } from "react";
import { compactMusicCoverUrl, type MusicSpec } from "@/lib/music";

/**
 * Server-rendered music shell. QQ selections carry their display snapshot, so
 * the cover/title/artist are visible before client JavaScript resolves audio.
 * MusicInitializer replaces this shell with the interactive player card.
 */
export function MusicEmbed({ spec }: { spec: MusicSpec }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hasSnapshot = spec.server === "qqvip" && Boolean(spec.title);
  useEffect(() => {
    // 全局初始化器只能在这张 Client Component 完成水合后改写其 DOM。
    // 否则流式 SSR 较慢时会抢先插入播放器，React 随后看到额外节点并触发 #418。
    const container = containerRef.current;
    if (!container) return;
    container.dataset.hydrated = "1";
    container.dispatchEvent(new CustomEvent("yezi:music-hydrated", { bubbles: true }));
    return () => {
      delete container.dataset.hydrated;
    };
  }, []);
  return (
    <div
      ref={containerRef}
      className="blog-music"
      data-server={spec.server}
      data-id={spec.id}
      data-type={spec.type}
      data-shuffle={spec.shuffle ? "1" : "0"}
      data-music-name={spec.title || undefined}
      data-music-artist={spec.artist || undefined}
      data-music-cover={spec.cover || undefined}
    >
      {hasSnapshot && (
        <div className="music-trigger music-trigger-static">
          <span className="music-trigger-swipe-stage">
            <span className="music-trigger-swipe-slide" data-track-slot="current">
              <span className={"music-trigger-cover" + (spec.cover ? "" : " is-fallback")}>
                {spec.cover && <img className="site-image-media site-image-loading" src={compactMusicCoverUrl(spec.cover)} alt="" />}
              </span>
              <span className="music-trigger-info">
                <span className="music-trigger-name">{spec.title}</span>
                <span className="music-trigger-artist">
                  <span className="music-trigger-artist-name">{spec.artist}</span>
                </span>
              </span>
            </span>
          </span>
          <span className="music-trigger-play" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}
