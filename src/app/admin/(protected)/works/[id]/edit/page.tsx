import { notFound } from "next/navigation";
import { getWork } from "@/lib/db";
import WorkForm from "@/components/admin/WorkForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default async function EditWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = getWork(Number(id));
  if (!work) notFound();

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader eyebrow="EDIT WORK" title="编辑作品" description="修改作品展示内容、封面、链接和排序。" />
      <WorkForm work={work} />
    </div>
  );
}
