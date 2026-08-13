import type { MetadataRoute } from "next";
import { listPosts } from "@/lib/db";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const revalidate = 300;

export default function sitemap(): MetadataRoute.Sitemap {
  const staticPages: MetadataRoute.Sitemap = [
    { url: site.url, changeFrequency: "daily", priority: 1 },
    { url: `${site.url}/moments`, changeFrequency: "daily", priority: 0.8 },
    { url: `${site.url}/references`, changeFrequency: "daily", priority: 0.7 },
    { url: `${site.url}/works`, changeFrequency: "weekly", priority: 0.6 },
    { url: `${site.url}/about`, changeFrequency: "monthly", priority: 0.4 },
  ];
  const posts: MetadataRoute.Sitemap = listPosts().map((post) => ({
    url: `${site.url}/posts/${post.slug}`,
    lastModified: new Date(post.updated_at),
    changeFrequency: "weekly",
    priority: 0.8,
  }));
  return [...staticPages, ...posts];
}
