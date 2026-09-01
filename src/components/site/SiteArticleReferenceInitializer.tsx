"use client";

import { useEffect } from "react";

/**
 * 本站文章引用在桌面端由 CSS hover/focus 展示摘要；触摸设备没有 hover，
 * 因而第一下轻触只打开提示，短时间内第二下才按普通链接跳转。
 */
export function SiteArticleReferenceInitializer() {
  useEffect(() => {
    let lastTouchAt = 0;
    let closeTimer: number | null = null;

    const close = (except?: HTMLElement) => {
      document.querySelectorAll<HTMLElement>(".site-article-reference.is-tooltip-open").forEach((item) => {
        if (item !== except) item.classList.remove("is-tooltip-open");
      });
    };
    const open = (wrapper: HTMLElement) => {
      close(wrapper);
      wrapper.classList.add("is-tooltip-open");
      if (closeTimer !== null) window.clearTimeout(closeTimer);
      closeTimer = window.setTimeout(() => {
        wrapper.classList.remove("is-tooltip-open");
        closeTimer = null;
      }, 4_000);
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") lastTouchAt = Date.now();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>(".site-article-reference-link");
      if (!link) {
        close();
        return;
      }
      const wrapper = link.closest<HTMLElement>(".site-article-reference");
      if (!wrapper) return;
      const touchInteraction = Date.now() - lastTouchAt < 900 || window.matchMedia("(hover: none)").matches;
      if (!touchInteraction || wrapper.classList.contains("is-tooltip-open")) return;
      event.preventDefault();
      open(wrapper);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown);
      if (closeTimer !== null) window.clearTimeout(closeTimer);
    };
  }, []);

  return null;
}
