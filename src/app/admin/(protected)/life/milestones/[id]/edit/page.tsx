import { notFound } from "next/navigation";
import { getLifeEvent } from "@/lib/db";
import LifeEventForm from "@/components/admin/LifeEventForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";

export const dynamic = "force-dynamic";

export default async function EditLifeEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = getLifeEvent(Number(id));
  if (!event) notFound();

  return (
    <div className="admin-page flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader backHref="/admin/life/milestones" backLabel="返回生活节点" eyebrow="EDIT MILESTONE" title="编辑生活节点" description="修改经历的时间、内容与展示信息。来源絮语不受影响。" />
      <div className="admin-card admin-form-panel">
        <LifeEventForm mode="edit" event={event} />
      </div>
    </div>
  );
}
