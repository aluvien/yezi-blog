import { notFound } from "next/navigation";
import { getMoment } from "@/lib/db";
import MomentForm from "@/components/admin/MomentForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default async function EditMomentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const moment = getMoment(Number(id));
  if (!moment) notFound();

  return (
    <div className="admin-page flex flex-col gap-4">
      <AdminPageHeader backHref="/admin/moments" backLabel="返回絮语列表" eyebrow="EDIT MOMENT" title="编辑絮语" description="修改絮语内容、标签、图片和发布信息。" />
      <MomentForm moment={moment} />
    </div>
  );
}
