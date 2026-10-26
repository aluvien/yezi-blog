"use client";

import { useState } from "react";
import { LightboxOverlay } from "@/components/site/ImageLightbox";
import { SiteImage } from "@/components/site/SiteImage";
import { groupMomentImages } from "@/lib/moments";
import { momentImageCropStyle, momentImageFrameStyle, type MomentImageCrops } from "@/lib/moment-image-crops";

/** 絮语配图：社交九宫格排列 + 点击灯箱预览。 */
export function MomentImages({ images, imageCrops = {} }: { images: string[]; imageCrops?: MomentImageCrops }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (images.length === 0) return null;

  const flat = images.slice(0, 9);
  const groups = groupMomentImages(flat);

  return (
    <>
      <div className="moment-images mt-2 flex flex-col gap-1.5">
        {groups.map((row, rowIdx) => {
          const startIndex = groups.slice(0, rowIdx).reduce((sum, g) => sum + g.length, 0);
          return (
            <div key={rowIdx} className={`flex gap-1.5 ${row.length === 1 ? "max-w-[min(100%,320px)]" : ""}`}>
              {row.map((src, colIdx) => (
                <button
                  key={colIdx}
                  type="button"
                  onClick={() => setLightboxIndex(startIndex + colIdx)}
                  className="relative aspect-square flex-1 overflow-hidden rounded-md bg-soft"
                  style={momentImageFrameStyle(imageCrops[src], flat.length === 1)}
                  aria-label="查看图片"
                >
                  <SiteImage
                    src={src}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 30vw, 200px"
                    className="h-full w-full object-cover"
                    style={momentImageCropStyle(imageCrops[src])}
                  />
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {lightboxIndex !== null && (
        <LightboxOverlay
          images={flat.map((src) => ({ src, alt: "" }))}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
