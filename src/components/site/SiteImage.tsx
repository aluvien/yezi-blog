"use client";

import Image from "next/image";
import { useState, type CSSProperties } from "react";
import imageLoader from "@/lib/image-loader";

type SiteImageProps = {
  src: string;
  alt: string;
  className?: string;
  sizes?: string;
  fill?: boolean;
  width?: number;
  height?: number;
  quality?: number;
  priority?: boolean;
  loading?: "lazy" | "eager";
  style?: CSSProperties;
};

function isLocalImage(src: string): boolean {
  return src.startsWith("/") && !src.startsWith("//") && !src.startsWith("/_next/");
}

const FALLBACK_IMAGE = "/placeholder.svg";

/**
 * 前台图片统一入口：本地上传图交给 Next Image 按需缩放，外部 URL 保留原生 img 兼容性。
 * fill 模式下由调用方提供 relative 容器，避免图片加载前撑开布局。
 */
export function SiteImage({
  src,
  alt,
  className = "",
  sizes = "100vw",
  fill = false,
  width,
  height,
  quality = 72,
  priority = false,
  loading,
  style,
}: SiteImageProps) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const resolvedLoading = priority ? "eager" : (loading ?? "lazy");
  const renderedSrc = failedSrc === src ? FALLBACK_IMAGE : src;
  const loaded = loadedSrc === renderedSrc || failedSrc === src;
  const failed = failedSrc === src;
  const imageClassName = [
    "site-image-media",
    loaded ? "site-image-ready" : "site-image-loading",
    fill && !isLocalImage(src) ? "absolute inset-0" : "",
    className,
  ].filter(Boolean).join(" ");
  const handleLoaded = () => setLoadedSrc(renderedSrc);
  const handleError = () => {
    if (renderedSrc === FALLBACK_IMAGE) return;
    setLoadedSrc(FALLBACK_IMAGE);
    setFailedSrc(src);
  };

  if (isLocalImage(src) && !failed) {
    if (fill) {
      return (
        <Image
          src={src}
          alt={alt}
          loader={imageLoader}
          fill
          sizes={sizes}
          quality={quality}
          preload={priority}
          loading={resolvedLoading}
          decoding="async"
          className={imageClassName}
          style={style}
          onLoad={handleLoaded}
          onError={handleError}
        />
      );
    }
    return (
      <Image
        src={src}
        alt={alt}
        loader={imageLoader}
        width={width ?? 1200}
        height={height ?? 800}
        sizes={sizes}
        quality={quality}
        preload={priority}
        loading={resolvedLoading}
        decoding="async"
        className={imageClassName}
        style={style}
        onLoad={handleLoaded}
        onError={handleError}
      />
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={renderedSrc}
      alt={alt}
      width={width}
      height={height}
      loading={resolvedLoading}
      decoding="async"
      className={`${imageClassName} ${fill ? "absolute inset-0" : ""}`}
      style={style}
      onLoad={handleLoaded}
      onError={handleError}
    />
  );
}
