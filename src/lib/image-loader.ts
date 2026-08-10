"use client";

type ImageLoaderProps = {
  src: string;
  width: number;
  quality?: number;
};

/** Next Image 的外部 URL 生成器：页面显示 /image，内部由 rewrite 转给 Next 优化器。 */
export default function imageLoader({ src, width, quality }: ImageLoaderProps): string {
  const params = new URLSearchParams({
    url: src,
    w: String(width),
    q: String(quality ?? 72),
  });
  return `/image?${params.toString()}`;
}
