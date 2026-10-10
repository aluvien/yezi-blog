import MomentForm from "@/components/admin/MomentForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export default function NewMomentPage() {
  return (
    <div className="admin-page flex flex-col gap-4">
      <AdminPageHeader backHref="/admin/moments" backLabel="返回絮语列表" eyebrow="NEW MOMENT" title="写絮语" description="记录一条絮语，可填写标签、附加图片并发布到前台。" />
      <MomentForm />
    </div>
  );
}
