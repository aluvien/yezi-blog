import LifeEventForm from "@/components/admin/LifeEventForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";

export default function NewLifeEventPage() {
  return (
    <div className="admin-page flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader backHref="/admin/life/milestones" backLabel="返回生活节点" eyebrow="NEW MILESTONE" title="添加生活节点" description="记录一段真实经历发生的时间与经过，时间线会按“实际发生时间”排列。" />
      <div className="admin-card admin-form-panel">
        <LifeEventForm mode="create" />
      </div>
    </div>
  );
}
