/**
 * 桌面端滚动容器是 `.site-main`（body / .site-frame-body 均为 overflow:hidden），
 * 移动端则是整页 window 滚动。这两个工具同时监听两者，保证任何尺寸下滚动都能触发。
 * 仅在客户端（useEffect 内）调用。
 */

export function attachScrollListener(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const container = document.querySelector<HTMLElement>(".site-main");
  const targets: Array<HTMLElement | Window> = [window];
  if (container) targets.push(container);
  const options: AddEventListenerOptions = { passive: true };
  for (const target of targets) target.addEventListener("scroll", handler, options);
  window.addEventListener("resize", handler);
  return () => {
    for (const target of targets) target.removeEventListener("scroll", handler);
    window.removeEventListener("resize", handler);
  };
}

export interface ScrollPosition {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

export function readScrollPosition(): ScrollPosition {
  if (typeof window === "undefined") return { scrollTop: 0, scrollHeight: 0, clientHeight: 0 };
  const container = document.querySelector<HTMLElement>(".site-main");
  // 桌面端 .site-main 内容溢出即为滚动容器；移动端它不溢出，退回 window。
  if (container && container.scrollHeight > container.clientHeight) {
    return {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
  }
  return {
    scrollTop: window.scrollY,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: window.innerHeight,
  };
}

/** 滚动到顶部：桌面端滚 .site-main，移动端滚 window。 */
export function scrollToTop(behavior: ScrollBehavior = "smooth"): void {
  if (typeof window === "undefined") return;
  const container = document.querySelector<HTMLElement>(".site-main");
  if (container && container.scrollHeight > container.clientHeight) {
    container.scrollTo({ top: 0, behavior });
  } else {
    window.scrollTo({ top: 0, behavior });
  }
}
