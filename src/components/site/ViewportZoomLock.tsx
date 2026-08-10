"use client";

import { useEffect } from "react";

/** 移动端禁止页面缩放，同时保留单指滚动。部分 iOS 版本会忽略 viewport 的 user-scalable=no。 */
export function ViewportZoomLock() {
  useEffect(() => {
    const preventPinch = (event: TouchEvent) => {
      if (event.touches.length > 1) event.preventDefault();
    };
    const preventSafariGesture = (event: Event) => event.preventDefault();
    const preventDoubleTapZoom = (event: MouseEvent) => event.preventDefault();

    document.addEventListener("touchstart", preventPinch, { passive: false });
    document.addEventListener("touchmove", preventPinch, { passive: false });
    document.addEventListener("gesturestart", preventSafariGesture, { passive: false });
    document.addEventListener("gesturechange", preventSafariGesture, { passive: false });
    document.addEventListener("gestureend", preventSafariGesture, { passive: false });
    document.addEventListener("dblclick", preventDoubleTapZoom, { passive: false });

    return () => {
      document.removeEventListener("touchstart", preventPinch);
      document.removeEventListener("touchmove", preventPinch);
      document.removeEventListener("gesturestart", preventSafariGesture);
      document.removeEventListener("gesturechange", preventSafariGesture);
      document.removeEventListener("gestureend", preventSafariGesture);
      document.removeEventListener("dblclick", preventDoubleTapZoom);
    };
  }, []);

  return null;
}
