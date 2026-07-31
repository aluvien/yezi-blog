"use client";

import { useCallback, useEffect, useState } from "react";

function LightboxOverlay({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="max-h-full max-w-full object-contain"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur"
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export function ArticleImageWrapper({ children }: { children: React.ReactNode }) {
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === "IMG" && target.closest(".article-body")) {
      const img = target as HTMLImageElement;
      setLightbox({ src: img.src, alt: img.alt });
    }
  }, []);

  return (
    <>
      <div onClick={handleClick}>{children}</div>
      {lightbox && (
        <LightboxOverlay
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}
