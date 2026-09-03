import { getAuthorAvatar } from "@/lib/author";
import { apiJson, apiOptions } from "@/lib/api";
import { getSiteSettings } from "@/lib/db";
import { getSiteAuthor, parseSocialLinks, site } from "@/lib/site";
import { getVisibleNavItems } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explicit allowlist of the same settings already rendered on public pages.
 * In particular, author email, QQ Music credentials/settings, Telegram and
 * appearance preferences stay server-private.
 */
export function GET() {
  const settings = getSiteSettings();
  const name = settings.site_name?.trim() || site.name;
  const subtitle = settings.site_subtitle?.trim() || "文章 · 絮语 · 作品";
  return apiJson({
    data: {
      name,
      subtitle,
      description: site.description,
      logo: settings.site_logo?.trim() || null,
      author: {
        name: getSiteAuthor(settings),
        avatar: getAuthorAvatar(settings),
        avatar_no_border: settings.author_avatar_no_border === "1",
      },
      about_content: settings.about_content?.trim() || null,
      social_links: parseSocialLinks(settings.social_links, 6),
      navigation: getVisibleNavItems(settings).map(({ href, label }) => ({ href, label })),
    },
  }, 200, { cache: "short" });
}

export function OPTIONS() {
  return apiOptions();
}
