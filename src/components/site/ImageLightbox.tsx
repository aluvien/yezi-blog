"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function LightboxOverlay({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: Array<{ src: string; alt: string }>;
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const hasMultiple = images.length > 1;
  const scrollRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(index);
  // 记录指针按下位置，用于区分“点击”和“拖动滑动”：拖动后不触发关闭
  const downPos = useRef<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  // 滚动到指定图片：手动 rAF 动画，避免依赖浏览器 smooth scroll（在 snap 容器上不可靠）
  const scrollToIndex = useCallback(
    (i: number, smooth: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(images.length - 1, i));
      const child = el.children[clamped] as HTMLElement | undefined;
      if (!child) return;
      const target = child.offsetLeft - (el.clientWidth - child.offsetWidth) / 2;
      if (!smooth) {
        el.scrollLeft = target;
        return;
      }
      const start = el.scrollLeft;
      const distance = target - start;
      if (Math.abs(distance) < 1) return;
      const duration = 300;
      const startTime = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration);
        el.scrollLeft = start + distance * (1 - Math.pow(1 - t, 3));
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [images.length],
  );

  const goTo = useCallback((i: number) => scrollToIndex(i, true), [scrollToIndex]);

  // 初始定位到点击的那张（无动画）
  useEffect(() => {
    scrollToIndex(index, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && hasMultiple) goTo(active - 1);
      else if (e.key === "ArrowRight" && hasMultiple) goTo(active + 1);
    },
    [hasMultiple, active, goTo, onClose],
  );

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus({ preventScroll: true });
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
      previousFocusRef.current?.focus({ preventScroll: true });
    };
  }, [handleKeyDown]);

  // 滚动时更新当前索引（计数与键盘基准）
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const center = el.scrollLeft + el.clientWidth / 2;
    let nearest = 0;
    let best = Infinity;
    Array.from(el.children).forEach((child, i) => {
      const node = child as HTMLElement;
      const d = Math.abs(node.offsetLeft + node.offsetWidth / 2 - center);
      if (d < best) {
        best = d;
        nearest = i;
      }
    });
    if (nearest !== active) {
      setActive(nearest);
      onIndexChange(nearest);
    }
  }, [active, onIndexChange]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    downPos.current = { x: e.clientX, y: e.clientY };
    moved.current = false;
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const dp = downPos.current;
    if (!dp) return;
    if (Math.abs(e.clientX - dp.x) > 8 || Math.abs(e.clientY - dp.y) > 8) moved.current = true;
  }, []);
  const onPointerUp = useCallback(() => {
    downPos.current = null;
  }, []);
  const onClick = useCallback(() => {
    // 拖动滑动后不关闭；只有纯点击空白才关闭（图片自身 stopPropagation）
    if (moved.current) {
      moved.current = false;
      return;
    }
    onClose();
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="图片预览"
      className="fixed inset-0 z-[100] bg-black/90"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onClick={onClick}
    >
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex h-full w-full snap-x snap-mandatory items-center gap-6 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {images.map((img, i) => (
          <div key={i} className="flex h-full w-full shrink-0 snap-start items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.src}
              alt={img.alt}
              draggable={false}
              className="max-h-[84vh] max-w-[86vw] select-none object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        ))}
      </div>
      {hasMultiple && (
        <>
          <button
            type="button"
            aria-label="上一张"
            disabled={active === 0}
            onClick={(e) => { e.stopPropagation(); goTo(active - 1); }}
            className="absolute left-6 top-1/2 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 p-0 text-white backdrop-blur transition hover:bg-white/30 disabled:opacity-30 md:flex"
          >
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="下一张"
            disabled={active === images.length - 1}
            onClick={(e) => { e.stopPropagation(); goTo(active + 1); }}
            className="absolute right-6 top-1/2 hidden h-14 w-14 -translate-y-1/2 items-center justify-center rounded-full bg-white/15 p-0 text-white backdrop-blur transition hover:bg-white/30 disabled:opacity-30 md:flex"
          >
            <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
        </>
      )}
      <button
        ref={closeButtonRef}
        type="button"
        aria-label="关闭"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-5 top-4 z-10 flex h-14 w-14 items-center justify-center text-white/65 transition-colors hover:text-white"
      >
        <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <path d="m5 5 14 14M19 5 5 19" />
        </svg>
      </button>
      {hasMultiple && (
        <span className="pointer-events-none absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full bg-black/40 px-3 py-1 font-mono text-xs text-white/80">
          {active + 1} / {images.length}
        </span>
      )}
    </div>
  );
}

export function ArticleImageWrapper({ children }: { children: React.ReactNode }) {
  const [lightbox, setLightbox] = useState<{ images: Array<{ src: string; alt: string }>; index: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = contentRef.current;
    if (!root) return;
    const images = Array.from(root.querySelectorAll<HTMLImageElement>(".article-content-image"));
    const cleanups = images.map((image) => {
      const markLoaded = () => {
        image.classList.remove("site-image-loading");
        image.classList.add("site-image-ready");
      };
      if (image.complete && image.naturalWidth > 0) markLoaded();
      else image.addEventListener("load", markLoaded, { once: true });
      return () => image.removeEventListener("load", markLoaded);
    });
    return () => cleanups.forEach((cleanup) => cleanup());
  }, [children]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const container = e.currentTarget as HTMLElement;
    if (target.tagName === "IMG" && container.contains(target)) {
      const img = target as HTMLImageElement;
      const images = Array.from(container.querySelectorAll("img")).map((item) => ({
        // 正文缩略图使用 Next Image 优化地址，灯箱改回原图地址。
        src: item.dataset.originalSrc || item.currentSrc || item.src,
        alt: item.alt,
      }));
      const originalSrc = img.dataset.originalSrc || img.currentSrc || img.src;
      const index = Math.max(0, images.findIndex((item) => item.src === originalSrc));
      setLightbox({ images, index });
    }
  }, []);

  return (
    <>
      <div ref={contentRef} onClick={handleClick}>{children}</div>
      {lightbox && (
        <LightboxOverlay
          images={lightbox.images}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((current) => current ? { ...current, index } : current)}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
