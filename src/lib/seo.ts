import type { Post } from "@/lib/db/types";
import { stripMarkdown } from "@/lib/markdown";
import { getSiteAuthor, parseSocialLinks, site } from "@/lib/site";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const SEO_DESCRIPTION_LIMIT = 300;

export function siteSearchDescription(settings: Record<string, string>): string {
  return stripMarkdown(settings.seo_description?.trim() || settings.site_subtitle?.trim() || site.description, SEO_DESCRIPTION_LIMIT);
}

export function postSearchDescription(post: Pick<Post, "content" | "seo_description">): string {
  return post.seo_description?.trim()
    ? stripMarkdown(post.seo_description, SEO_DESCRIPTION_LIMIT)
    : stripMarkdown(post.content, 120);
}

function publicUrl(value: string | null | undefined, siteUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, siteUrl);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export function siteStructuredData(settings: Record<string, string>, siteUrl: string) {
  const root = new URL("/", siteUrl).href;
  const sameAs = parseSocialLinks(settings.social_links).flatMap(link => publicUrl(link.url, root) ?? []);
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${root}#website`, url: root,
        name: settings.site_name?.trim() || site.name, description: siteSearchDescription(settings),
        inLanguage: "zh-CN", author: { "@id": `${root}#author` } },
      { "@type": "Person", "@id": `${root}#author`, name: getSiteAuthor(settings),
        url: new URL(PUBLIC_ROUTES.about, root).href, ...(sameAs.length ? { sameAs } : {}) },
    ],
  };
}

export function postStructuredData(post: Post, settings: Record<string, string>, siteUrl: string) {
  const root = new URL("/", siteUrl).href;
  const url = new URL(PUBLIC_ROUTES.post(post.slug), root).href;
  const image = publicUrl(post.cover, root);
  return {
    "@context": "https://schema.org", "@type": "BlogPosting", "@id": `${url}#article`,
    url, mainEntityOfPage: { "@type": "WebPage", "@id": url },
    headline: post.title, description: postSearchDescription(post),
    datePublished: post.created_at, dateModified: post.updated_at,
    inLanguage: "zh-CN", isPartOf: { "@id": `${root}#website` },
    author: { "@type": "Person", "@id": `${root}#author`, name: getSiteAuthor(settings), url: new URL(PUBLIC_ROUTES.about, root).href },
    ...(image ? { image: [image] } : {}),
  };
}

/** JSON-LD is embedded in HTML; escaping '<' prevents a closing script tag. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
