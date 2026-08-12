import AdminPageHeader from "@/components/admin/AdminPageHeader";
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";
import { getSiteSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function AdminAppearanceSettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader
        eyebrow="APPEARANCE"
        title="外观主题"
        description="选择前台版式、配色与默认深色模式，不会影响现有内容。"
      />
      <SiteSettingsForm initialValues={getSiteSettings()} section="appearance" />
    </div>
  );
}
