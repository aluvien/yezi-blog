"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * These paths are handled by the browser/server directly rather than by the
 * App Router. Sending them through router.push would turn a download or an
 * API response into a document navigation and could also hide the response
 * headers that the caller expects.
 */
const NON_PAGE_PREFIX = /^\/(?:api|_next|uploads)(?:\/|$)/i;
const NON_PAGE_EXTENSION = /\.(?:xml|txt|json|csv|pdf|zip|mp3|mp4|webm|mov|jpe?g|png|gif|webp|svg|ico|woff2?)(?:$|\/)/i;
const CONTENT_BOUNDARY = [
  ".article-body",
  ".classic-article-prose",
  ".moment-entry-content",
  ".bit-body",
  ".classic-life-content",
  ".classic-life-entry__markdown",
  ".about-body",
  ".classic-sidebar-markdown",
  ".classic-home-markdown",
].join(", ");

/**
 * Return an App Router destination for an ordinary same-origin document link.
 * Keeping this decision in one place makes the click listener deliberately
 * conservative: modified clicks, downloads, external targets and same-page
 * anchors keep the browser's native behavior.
 */
export function getInternalNavigationHref(link: HTMLAnchorElement, event: MouseEvent): string | null {
  if (
    event.defaultPrevented
    || event.button !== 0
    || event.metaKey
    || event.ctrlKey
    || event.shiftKey
    || event.altKey
  ) return null;

  if (
    link.hasAttribute("download")
    || (link.target && link.target !== "_self")
    || link.dataset.noClientNavigation === "true"
    || link.getAttribute("aria-disabled") === "true"
    || link.closest(".site-article-reference-link")
  ) return null;

  // Next <Link> already performs a soft transition and may have its own
  // conditional onClick. Limit this fallback to HTML fragments rendered by
  // Markdown/legacy content, where no React handler exists to take over.
  if (!link.closest(CONTENT_BOUNDARY)) return null;

  const rawHref = link.getAttribute("href")?.trim();
  // Hash-only links never reload the document, so letting the browser handle
  // them preserves native focus/scroll behavior without touching the player.
  if (!rawHref || rawHref.startsWith("#")) return null;

  let destination: URL;
  try {
    destination = new URL(link.href || rawHref, window.location.href);
  } catch {
    return null;
  }

  const current = new URL(window.location.href);
  if (destination.origin !== current.origin) return null;
  if (destination.pathname === current.pathname && destination.search === current.search) return null;
  if (NON_PAGE_PREFIX.test(destination.pathname) || NON_PAGE_EXTENSION.test(destination.pathname)) return null;

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

/**
 * Markdown and legacy template fragments render native <a> elements instead
 * of Next <Link>. Intercepting their same-origin clicks here turns those
 * navigations into soft transitions, so the layout-resident global player is
 * not unmounted when an article or moments page link is opened.
 */
export function SiteInternalLinkInitializer() {
  const router = useRouter();

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link) return;

      const destination = getInternalNavigationHref(link, event);
      if (!destination) return;

      event.preventDefault();
      router.push(destination);
    };

    // Capture runs before a raw anchor's default action while still allowing
    // the article-reference initializer to own its touch tooltip interaction.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [router]);

  return null;
}
