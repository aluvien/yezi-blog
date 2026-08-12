import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AboutPageForm from "@/components/admin/AboutPageForm";
import { getSiteSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function AdminAboutPage() {
  const settings = getSiteSettings();
  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader
        eyebrow="ABOUT PAGE"
        title="关于"
        description="编辑前台“关于”页面的介绍内容。"
      />
      <AboutPageForm initialValue={settings.about_content ?? ""} />
    </div>
  );
}
