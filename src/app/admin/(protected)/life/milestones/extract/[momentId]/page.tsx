import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLifeEventBySourceMoment, getMoment } from "@/lib/db";
import { getMomentExtractSeed } from "@/lib/admin/life-events";
import LifeEventForm from "@/components/admin/LifeEventForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";

export const dynamic = "force-dynamic";

export default async function ExtractFromMomentPage({ params }: { params: Promise<{ momentId: string }> }) {
  const { momentId } = await params;
  const id = Number(momentId);
  if (!getMoment(id)) notFound();

  // 已提取过就直接跳到既有的整理界面，避免重复创建。
  const existing = getLifeEventBySourceMoment(id);
  if (existing) redirect(`/admin/life/milestones/${existing.id}/edit`);

  const seed = getMomentExtractSeed(id);
  if (!seed) notFound();

  return (
    <div className="flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader eyebrow="LIFE · EXTRACT" title="整理成生活节点" description="已从这条絮语预填内容、图片、标签与日期；补一个标题、确认发生时间后保存即可。" />
      <div className="rounded-2xl bg-white p-4 shadow-sm sm:p-6">
        <LifeEventForm mode="extract" momentId={id} seed={seed} />
        <p className="mt-4 text-xs text-neutral-400">
          原絮语会原样保留，可在 <Link href="/moments" className="text-neutral-500 underline">前台絮语页</Link> 查看。
        </p>
      </div>
    </div>
  );
}
