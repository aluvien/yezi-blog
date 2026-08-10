import WorkForm from "@/components/admin/WorkForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export default function NewWorkPage() {
  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader eyebrow="NEW WORK" title="添加作品" description="新增一个作品展示项目，设置封面、简介、链接和排序。" />
      <WorkForm />
    </div>
  );
}
