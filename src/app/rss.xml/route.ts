import { listPosts, listMoments, parseMomentImages } from "@/lib/db";
import { stripMarkdown } from "@/lib/markdown";
import { site } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function GET() {
  const items = [
    ...listPosts().map((post) => ({
      title: post.title,
      link: `${site.url}/posts/${post.slug}`,
      description: stripMarkdown(post.content, 200),
      pubDate: new Date(post.created_at).toUTCString(),
      guid: `post-${post.id}`,
    })),
    ...listMoments().map((moment) => {
      const text = moment.content.replace(/\s+/g, " ").trim();
      const images = parseMomentImages(moment);
      return {
        title: text.length > 40 ? text.slice(0, 40) + "…" : text,
        link: `${site.url}/moments#moment-${moment.id}`,
        description: moment.content + (images.length ? `\n图片：${images.join(" ")}` : ""),
        pubDate: new Date(moment.created_at).toUTCString(),
        guid: `moment-${moment.id}`,
      };
    }),
  ].sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <link>${escapeXml(site.url)}</link>
    <description>${escapeXml(site.description)}</description>
    <language>zh-CN</language>
${items
  .map(
    (item) => `    <item>
      <title>${escapeXml(item.title)}</title>
      <link>${escapeXml(item.link)}</link>
      <description>${escapeXml(item.description)}</description>
      <pubDate>${item.pubDate}</pubDate>
      <guid isPermaLink="false">${escapeXml(item.guid)}</guid>
    </item>`,
  )
  .join("\n")}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  });
}
