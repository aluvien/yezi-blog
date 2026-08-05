import type { Metadata } from "next";
import { countApprovedCommentsBulk, getContentMetricsBulk, getSiteSettings, hasLikedBulk, listMoments, listPosts } from "@/lib/db";
import { site } from "@/lib/site";
import { getAuthorAvatar } from "@/lib/author";
import { getVisitorKeyFromRequest } from "@/lib/request";
import { MobileFeed, type FeedItem } from "@/components/site/MobileFeed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: site.description,
  alternates: { canonical: "/" },
};

export default async function Home() {
  const posts = listPosts();
  const moments = listMoments();
  const siteSettings = getSiteSettings();
  const authorAvatar = getAuthorAvatar(siteSettings) || undefined;
  const visitorKey = await getVisitorKeyFromRequest();
  const postIds = posts.map((post) => post.id);
  const momentIds = moments.map((moment) => moment.id);
  const postCommentCounts = countApprovedCommentsBulk("post", postIds);
  const momentCommentCounts = countApprovedCommentsBulk("moment", momentIds);
  const postMetrics = getContentMetricsBulk("post", postIds);
  const momentMetrics = getContentMetricsBulk("moment", momentIds);
  const postLiked = hasLikedBulk("post", postIds, visitorKey);
  const momentLiked = hasLikedBulk("moment", momentIds, visitorKey);
  const emptyMetrics = { views: 0, likes: 0 };
  const items: FeedItem[] = [
    ...moments.map((moment) => ({
      type: "moment" as const,
      value: moment,
      commentCount: momentCommentCounts.get(moment.id) ?? 0,
      metrics: momentMetrics.get(moment.id) ?? emptyMetrics,
      initialLiked: momentLiked.get(moment.id) ?? false,
    })),
    ...posts.map((post) => ({
      type: "post" as const,
      value: post,
      commentCount: postCommentCounts.get(post.id) ?? 0,
      metrics: postMetrics.get(post.id) ?? emptyMetrics,
      initialLiked: postLiked.get(post.id) ?? false,
    })),
  ].sort((a, b) => new Date(b.value.created_at).getTime() - new Date(a.value.created_at).getTime());

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <MobileFeed items={items} authorName={site.author} authorAvatar={authorAvatar} authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"} />
    </div>
  );
}
