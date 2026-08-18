import {
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  serializeAdminComment,
  serializeAdminPostSummary,
} from "@/lib/admin-api";
import {
  countAttachments,
  countMoments,
  countPendingComments,
  countPosts,
  countPublishedPosts,
  countWorks,
  getContentMetricsBulk,
  getOverallMetrics,
  listCommentsForAdmin,
  listRecentPosts,
} from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await authorizeAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const recentPosts = listRecentPosts(5);
    const recentPostMetrics = getContentMetricsBulk("post", recentPosts.map((post) => post.id));
    const recentComments = listCommentsForAdmin(5);
    const postTotal = countPosts();
    const publishedPosts = countPublishedPosts();

    return adminSuccess({
      posts: {
        total: postTotal,
        published: publishedPosts,
        draft: Math.max(0, postTotal - publishedPosts),
      },
      comments: { pending: countPendingComments() },
      moments: countMoments(),
      works: countWorks(),
      attachments: countAttachments(),
      metrics: getOverallMetrics(),
      recent_posts: recentPosts.map((post) => serializeAdminPostSummary(post, recentPostMetrics.get(post.id) ?? { views: 0, likes: 0 })),
      recent_comments: recentComments.map(serializeAdminComment),
    });
  } catch (error) {
    return adminInternalError("dashboard", error);
  }
}
