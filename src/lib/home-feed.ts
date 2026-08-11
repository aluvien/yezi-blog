import {
  countMoments,
  countPublishedPosts,
  countApprovedCommentsBulk,
  getContentMetricsBulk,
  hasLikedBulk,
  listMoments,
  listPosts,
} from "@/lib/db";
import { stripMarkdown } from "@/lib/markdown";
import { toPostSummary, type FeedItem } from "@/lib/mobile-feed";

export const HOME_FEED_INITIAL_COUNT = 8;
export const HOME_FEED_BATCH_SIZE = 5;

type HomeFeedPageOptions = {
  offset: number;
  limit: number;
  visitorKey: string;
};

export type HomeFeedPage = {
  items: FeedItem[];
  hasMore: boolean;
};

/**
 * 合并文章与想法后再分页。两个来源各取到 offset + limit 条，足以保证合并
 * 时间流的这一页完整，同时避免首页把全部正文和图片信息都发送给浏览器。
 */
export function getHomeFeedPage({ offset, limit, visitorKey }: HomeFeedPageOptions): HomeFeedPage {
  const safeOffset = Math.max(0, Math.floor(offset));
  const safeLimit = Math.min(20, Math.max(1, Math.floor(limit)));
  const total = countPublishedPosts() + countMoments();
  if (safeOffset >= total) return { items: [], hasMore: false };

  const candidateLimit = Math.min(total, safeOffset + safeLimit);
  const posts = listPosts({ limit: candidateLimit });
  const moments = listMoments({ limit: candidateLimit });
  const selected = [
    ...moments.map((moment) => ({ type: "moment" as const, value: moment })),
    ...posts.map((post) => ({ type: "post" as const, value: post })),
  ]
    .sort((a, b) => new Date(b.value.created_at).getTime() - new Date(a.value.created_at).getTime())
    .slice(safeOffset, safeOffset + safeLimit);

  const postIds = selected.flatMap((item) => item.type === "post" ? [item.value.id] : []);
  const momentIds = selected.flatMap((item) => item.type === "moment" ? [item.value.id] : []);
  const postCommentCounts = countApprovedCommentsBulk("post", postIds);
  const momentCommentCounts = countApprovedCommentsBulk("moment", momentIds);
  const postMetrics = getContentMetricsBulk("post", postIds);
  const momentMetrics = getContentMetricsBulk("moment", momentIds);
  const postLiked = hasLikedBulk("post", postIds, visitorKey);
  const momentLiked = hasLikedBulk("moment", momentIds, visitorKey);
  const emptyMetrics = { views: 0, likes: 0 };

  const items: FeedItem[] = selected.map((item) => item.type === "moment"
    ? {
        type: "moment",
        value: item.value,
        commentCount: momentCommentCounts.get(item.value.id) ?? 0,
        metrics: momentMetrics.get(item.value.id) ?? emptyMetrics,
        initialLiked: momentLiked.get(item.value.id) ?? false,
      }
    : {
        type: "post",
        value: toPostSummary(item.value, stripMarkdown(item.value.content, 120)),
        commentCount: postCommentCounts.get(item.value.id) ?? 0,
        metrics: postMetrics.get(item.value.id) ?? emptyMetrics,
        initialLiked: postLiked.get(item.value.id) ?? false,
      });

  return { items, hasMore: safeOffset + items.length < total };
}
