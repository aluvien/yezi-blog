import { getSiteUrl } from "@/lib/site-config";
import type { MetadataRoute } from "next";
import { listPosts } from "@/lib/db";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getSiteUrl();
  const staticPages: MetadataRoute.Sitemap = [
    { url: siteUrl, changeFrequency: "daily", priority: 1 },
    { url: `${siteUrl}${PUBLIC_ROUTES.moments}`, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}${PUBLIC_ROUTES.life}`, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}${PUBLIC_ROUTES.references}`, changeFrequency: "daily", priority: 0.7 },
    { url: `${siteUrl}${PUBLIC_ROUTES.archives}`, changeFrequency: "daily", priority: 0.7 },
    { url: `${siteUrl}${PUBLIC_ROUTES.about}`, changeFrequency: "monthly", priority: 0.4 },
  ];
  const posts: MetadataRoute.Sitemap = listPosts().map((post) => ({
    url: `${siteUrl}${PUBLIC_ROUTES.post(post.slug)}`,
    lastModified: new Date(post.updated_at),
    changeFrequency: "weekly",
    priority: 0.8,
  }));
  return [...staticPages, ...posts];
}
