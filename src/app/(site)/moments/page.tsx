import type { Metadata } from "next";
import { listMoments, countApprovedComments } from "@/lib/db";
import { MomentEntry } from "@/components/site/MomentEntry";
import { CommentSection } from "@/components/site/CommentSection";
import { PageHeader } from "@/components/site/PageHeader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "想法",
  description: "随手记录的短想法。",
};

export default function MomentsPage() {
  const moments = listMoments();

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <PageHeader
        eyebrow="Short notes"
        title="想法"
        description="不必写成长文，也值得被记住的瞬间。"
        trailing={`${moments.length} 条记录`}
      />

      <section className="paper-card rounded-2xl px-5 md:px-8">
        {moments.length === 0 && <p className="py-20 text-center text-[14px] text-muted">还没有想法。</p>}
        <div className="divide-y divide-divider">
          {moments.map((moment) => {
            const count = countApprovedComments("moment", moment.id);
            return (
              <div key={moment.id} className="py-7 md:py-8">
                <MomentEntry
                  moment={moment}
                  commentCount={count}
                >
                  <CommentSection targetType="moment" targetId={moment.id} />
                </MomentEntry>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
