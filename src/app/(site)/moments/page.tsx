import type { Metadata } from "next";
import { countApprovedCommentsBulk, getContentMetricsBulk, getSiteSettings, hasLikedBulk, listMoments } from "@/lib/db";
import { getSiteAuthor } from "@/lib/site";
import { getAuthorAvatar } from "@/lib/author";
import { MomentEntry } from "@/components/site/MomentEntry";
import { CommentSection } from "@/components/site/CommentSection";
import { getSession } from "@/lib/auth";
import { getVisitorKeyFromRequest } from "@/lib/request";
import { MomentWriter } from "@/components/site/MomentWriter";
import { ClassicBitsList } from "@/components/site/ClassicBitsList";
import { ClassicBitsToolbar } from "@/components/site/ClassicBitsToolbar";
import { ClassicBitsMobileWriter } from "@/components/site/ClassicBitsMobileWriter";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "絮语",
  description: "随手记录的短絮语。",
  alternates: { canonical: PUBLIC_ROUTES.moments },
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

  if (siteSettings.layout_theme === "classic") {
    const years = Array.from(new Set(moments.map((moment) => moment.created_at.slice(0, 4))));
    return (
      <>
        <div className="page-header page-header--bits">
          <div className="page-heading"><h1 className="page-title">絮语</h1><span className="page-subtitle">生活不只是长篇</span></div>
          <ClassicBitsMobileWriter isAuthorized={isAuthorized} />
        </div>
        <ClassicBitsToolbar years={years} count={moments.length} isAuthorized={isAuthorized} />
        <ClassicBitsList
          moments={moments}
          authorName={authorName}
          authorAvatar={getAuthorAvatar(siteSettings) || undefined}
          commentCounts={Object.fromEntries(momentIds.map((id) => [String(id), commentCounts.get(id) ?? 0]))}
          showInteractions={siteSettings.classic_show_interactions !== "0"}
          showComments={siteSettings.classic_show_comments !== "0"}
          commentSections={siteSettings.classic_show_comments !== "0" ? moments.map((moment) => <CommentSection key={moment.id} targetType="moment" targetId={moment.id} authorName={authorName} />) : []}
        />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <MomentWriter count={moments.length} isAuthorized={isAuthorized} classic={siteSettings.layout_theme === "classic"} />

      <section className="moments-feed">
        {moments.length === 0 && <p className="py-20 text-center text-[14px] text-muted">还没有絮语。</p>}
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
