"use client";

import { useEffect } from "react";

/**
 * 本站文章引用在桌面端由 CSS hover/focus 展示摘要；触摸设备没有 hover，
 * 因而第一下轻触只打开提示，短时间内第二下才按普通链接跳转。
 */
export function SiteArticleReferenceInitializer() {
  useEffect(() => {
    const TOOLTIP_SELECTOR = ".site-article-reference-tooltip";
    const LINK_SELECTOR = ".site-article-reference-link";
    const BOUNDARY_SELECTOR = ".classic-article-detail, .article-body, .classic-article-prose, .classic-life-content, .classic-reference-list";
    const EDGE_PADDING = 8;
    let lastTouchAt = 0;
    let closeTimer: number | null = null;
    let positionFrame: number | null = null;

    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

    /**
     * Tooltip is absolutely positioned beside an inline link. A fixed width
     * alone cannot prevent an edge link from pushing the bubble outside the
     * article column, so calculate a safe offset inside the nearest content
     * boundary whenever the link is focused or hovered.
     */
    const positionTooltip = (wrapper: HTMLElement) => {
      const tooltip = wrapper.querySelector<HTMLElement>(TOOLTIP_SELECTOR);
      const link = wrapper.querySelector<HTMLElement>(LINK_SELECTOR);
      if (!tooltip || !link) return;

      // Re-measure the preferred CSS width before applying the previous clamp.
      wrapper.style.removeProperty("--site-reference-tooltip-max-width");
      wrapper.style.removeProperty("--site-reference-tooltip-left");
      wrapper.style.removeProperty("--site-reference-tooltip-arrow-left");
      wrapper.style.setProperty("--site-reference-tooltip-translate-x", "0px");

      const preferredWidth = tooltip.getBoundingClientRect().width;
      if (!Number.isFinite(preferredWidth) || preferredWidth <= 0) return;

      const boundary = wrapper.closest<HTMLElement>(BOUNDARY_SELECTOR);
      const boundaryRect = boundary?.getBoundingClientRect();
      const viewportRight = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
      // getBoundingClientRect() is viewport-relative, so keep both page edges
      // in the same coordinate space even if a nested scroller is horizontal.
      const viewportLeft = 0;
      const rawLeft = Math.max(viewportLeft + EDGE_PADDING, boundaryRect?.left ?? viewportLeft + EDGE_PADDING);
      const rawRight = Math.min(viewportRight - EDGE_PADDING, boundaryRect?.right ?? viewportRight - EDGE_PADDING);
      const availableWidth = Math.max(1, rawRight - rawLeft);
      const width = Math.min(preferredWidth, availableWidth);

      wrapper.style.setProperty("--site-reference-tooltip-max-width", `${width}px`);
      const wrapperRect = wrapper.getBoundingClientRect();
      const linkRect = link.getBoundingClientRect();
      const anchorCenter = linkRect.left + (linkRect.width / 2);
      const left = clamp(anchorCenter - (width / 2), rawLeft, rawRight - width);
      const arrowLeft = clamp(anchorCenter - left, 12, Math.max(12, width - 12));
      wrapper.style.setProperty("--site-reference-tooltip-left", `${left - wrapperRect.left}px`);
      wrapper.style.setProperty("--site-reference-tooltip-arrow-left", `${arrowLeft}px`);
    };

    const positionAllTooltips = () => {
      positionFrame = null;
      document.querySelectorAll<HTMLElement>(".site-article-reference").forEach((wrapper) => {
        // Hidden tooltips still contribute to scrollable overflow when their
        // default width starts at an edge link. Clamp every tooltip once on
        // mount (and again after a resize), not only after it is opened.
        positionTooltip(wrapper);
      });
    };

    const schedulePosition = () => {
      if (positionFrame !== null) return;
      positionFrame = window.requestAnimationFrame(positionAllTooltips);
    };

    const close = (except?: HTMLElement) => {
      document.querySelectorAll<HTMLElement>(".site-article-reference.is-tooltip-open").forEach((item) => {
        if (item !== except) item.classList.remove("is-tooltip-open");
      });
    };
    const open = (wrapper: HTMLElement) => {
      close(wrapper);
      positionTooltip(wrapper);
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
    const onPointerOver = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLElement>(LINK_SELECTOR);
      const wrapper = link?.closest<HTMLElement>(".site-article-reference");
      if (wrapper) positionTooltip(wrapper);
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLElement>(LINK_SELECTOR);
      const wrapper = link?.closest<HTMLElement>(".site-article-reference");
      if (wrapper) positionTooltip(wrapper);
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
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", schedulePosition);
    schedulePosition();
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", schedulePosition);
      if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
      if (closeTimer !== null) window.clearTimeout(closeTimer);
    };
  }, []);

  return null;
}
