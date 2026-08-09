"use client";

import { useState } from "react";
import { LightboxOverlay } from "@/components/site/ImageLightbox";
import { SiteImage } from "@/components/site/SiteImage";

/** 社交九宫格布局：根据图片数量把图片分成若干行（每行 1/2/3 张）。 */
function groupImages(images: string[]): string[][] {
  const n = images.length;
  if (n <= 3) return [images.slice(0, n)];
  if (n === 4) return [images.slice(0, 2), images.slice(2, 4)];
  if (n === 5) return [images.slice(0, 2), images.slice(2, 5)];
  if (n === 6) return [images.slice(0, 3), images.slice(3, 6)];
  if (n === 7) return [images.slice(0, 3), images.slice(3, 6), images.slice(6, 7)];
  if (n === 8) return [images.slice(0, 3), images.slice(3, 6), images.slice(6, 8)];
  return [images.slice(0, 3), images.slice(3, 6), images.slice(6, 9)]; // 9
}

/** 想法配图：社交九宫格排列 + 点击灯箱预览。 */
export function MomentImages({ images }: { images: string[] }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  if (images.length === 0) return null;

  const flat = images.slice(0, 9);
  const groups = groupImages(flat);

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
                  aria-label="查看图片"
                >
                  <SiteImage
                    src={src}
                    alt=""
                    fill
                    sizes="(max-width: 640px) 30vw, 200px"
                    className="h-full w-full object-cover"
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
