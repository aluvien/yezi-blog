import type { Metadata } from "next";
import { getSiteAuthor, site } from "@/lib/site";
import { getAuthorAvatar } from "@/lib/author";
import { getVisitorKeyFromRequest } from "@/lib/request";
import { MobileFeed } from "@/components/site/MobileFeed";
import { getSession } from "@/lib/auth";
import { HOME_FEED_BATCH_SIZE, HOME_FEED_INITIAL_COUNT, getHomeFeedPage } from "@/lib/home-feed";
import { getCachedSiteSettings } from "@/lib/server-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: site.description,
  alternates: { canonical: "/" },
};

export default async function Home() {
  const siteSettings = getCachedSiteSettings();
  const authorName = getSiteAuthor(siteSettings);
  const authorAvatar = getAuthorAvatar(siteSettings) || undefined;
  const isAuthorized = !!(await getSession());
  const visitorKey = await getVisitorKeyFromRequest();
  const initialPage = getHomeFeedPage({ offset: 0, limit: HOME_FEED_INITIAL_COUNT, visitorKey });

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <MobileFeed
        items={initialPage.items}
        authorName={authorName}
        authorAvatar={authorAvatar}
        authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"}
        canEdit={isAuthorized}
        pagination={{ initialHasMore: initialPage.hasMore, batchSize: HOME_FEED_BATCH_SIZE }}
      />
    </div>
  );
}
