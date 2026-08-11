"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type NavigationState = "idle" | "loading" | "slow" | "complete";

type PendingNavigation = {
  anchor: HTMLAnchorElement;
  href: string;
  routeKey: string;
  startedAt: number;
};

const MIN_VISIBLE_MS = 220;
const COMPLETE_VISIBLE_MS = 180;
// 两秒多仍未完成时，再明确告诉用户请求还在继续；进度线本身会在点击瞬间出现。
const SLOW_AFTER_MS = 2_400;

function clearPendingAnchor(anchor: HTMLAnchorElement | null): void {
  if (!anchor) return;
  anchor.classList.remove("site-link-pending");
  anchor.removeAttribute("aria-busy");
}

function sameDocumentNavigation(anchor: HTMLAnchorElement, event: MouseEvent): URL | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return null;
  const href = anchor.getAttribute("href")?.trim();
  if (!href || href.startsWith("#")) return null;

  const next = new URL(anchor.href || href, window.location.href);
  const current = new URL(window.location.href);
  if (next.origin !== current.origin) return null;
  if (next.pathname === current.pathname && next.search === current.search) return null;
  return next;
}

/** 给 Next 的客户端导航增加即时反馈，避免弱网下看起来像没有点到。 */
export function NavigationFeedback() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const routeKey = `${pathname}?${searchParams.toString()}`;
  const [state, setState] = useState<NavigationState>("idle");
  const [retryHref, setRetryHref] = useState("");
  const pendingRef = useRef<PendingNavigation | null>(null);
  const slowTimerRef = useRef<number | null>(null);
  const finishTimerRef = useRef<number | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const next = sameDocumentNavigation(anchor, event);
      if (!next) return;

      clearPendingAnchor(pendingRef.current?.anchor ?? null);
      if (slowTimerRef.current !== null) window.clearTimeout(slowTimerRef.current);
      if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);

      anchor.classList.add("site-link-pending");
      anchor.setAttribute("aria-busy", "true");
      pendingRef.current = {
        anchor,
        href: next.href,
        routeKey,
        startedAt: performance.now(),
      };
      setRetryHref(next.href);
      setState("loading");
      slowTimerRef.current = window.setTimeout(() => {
        setState((current) => current === "loading" ? "slow" : current);
      }, SLOW_AFTER_MS);
    };

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [routeKey]);

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || pending.routeKey === routeKey) return;

    const elapsed = performance.now() - pending.startedAt;
    const finishAfter = Math.max(0, MIN_VISIBLE_MS - elapsed);
    if (slowTimerRef.current !== null) window.clearTimeout(slowTimerRef.current);
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
    finishTimerRef.current = window.setTimeout(() => {
      setState("complete");
      clearTimerRef.current = window.setTimeout(() => {
        clearPendingAnchor(pendingRef.current?.anchor ?? null);
        pendingRef.current = null;
        setRetryHref("");
        setState("idle");
      }, COMPLETE_VISIBLE_MS);
    }, finishAfter);
  }, [routeKey]);

  useEffect(() => () => {
    clearPendingAnchor(pendingRef.current?.anchor ?? null);
    if (slowTimerRef.current !== null) window.clearTimeout(slowTimerRef.current);
    if (finishTimerRef.current !== null) window.clearTimeout(finishTimerRef.current);
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
  }, []);

  function retryNavigation() {
    if (!retryHref) return;
    window.location.assign(retryHref);
  }

  const progressValue = state === "complete" ? 100 : state === "slow" ? 68 : 24;
  return (
    <>
      <div
        className={`site-navigation-progress is-${state}`}
        role="progressbar"
        aria-label="页面加载进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state === "idle" ? undefined : progressValue}
      >
        <span />
      </div>
      {state === "slow" && (
        <div className="site-navigation-status" role="status" aria-live="polite">
          <span className="site-navigation-status-dot" aria-hidden="true" />
          <span>网络较慢，页面仍在加载</span>
          <button type="button" onClick={retryNavigation}>重试</button>
        </div>
      )}
    </>
  );
}
