import type { Metadata } from "next";
import { countApprovedCommentsBulk, getContentMetricsBulk, getSiteSettings, hasLikedBulk, listMoments } from "@/lib/db";
import { getSiteAuthor } from "@/lib/site";
import { getAuthorAvatar } from "@/lib/author";
import { MomentEntry } from "@/components/site/MomentEntry";
import { CommentSection } from "@/components/site/CommentSection";
import { getSession } from "@/lib/auth";
import { getVisitorKeyFromRequest } from "@/lib/request";
import { MomentWriter } from "@/components/site/MomentWriter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "想法",
  description: "随手记录的短想法。",
};

export default async function MomentsPage() {
  const moments = listMoments();
  const siteSettings = getSiteSettings();
  const authorName = getSiteAuthor(siteSettings);
  const isAuthorized = !!(await getSession());
  const visitorKey = await getVisitorKeyFromRequest();
  const momentIds = moments.map((moment) => moment.id);
  const commentCounts = countApprovedCommentsBulk("moment", momentIds);
  const metrics = getContentMetricsBulk("moment", momentIds);
  const liked = hasLikedBulk("moment", momentIds, visitorKey);
  const emptyMetrics = { views: 0, likes: 0 };

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <MomentWriter count={moments.length} isAuthorized={isAuthorized} />

      <section className="moments-feed">
        {moments.length === 0 && <p className="py-20 text-center text-[14px] text-muted">还没有想法。</p>}
        <div>
          {moments.map((moment) => {
            return (
              <div key={moment.id} className="site-list-entry py-7 md:py-8">
                <MomentEntry
                  moment={moment}
                  commentCount={commentCounts.get(moment.id) ?? 0}
                  metrics={metrics.get(moment.id) ?? emptyMetrics}
                  authorName={authorName}
                  authorAvatar={getAuthorAvatar(siteSettings) || undefined}
                  authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"}
                  initialLiked={liked.get(moment.id) ?? false}
                  canEdit={isAuthorized}
                >
                  <CommentSection targetType="moment" targetId={moment.id} authorName={authorName} />
                </MomentEntry>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
