import { getSiteSettings } from "@/lib/db";
import LogoutButton from "@/components/admin/LogoutButton";
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";
import SyncGithubButton from "@/components/admin/SyncGithubButton";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader
        eyebrow="SITE SETTINGS"
        title="站点设置"
        description="集中管理站点信息、个人资料、音乐和文章显示方式。"
        actions={<SyncGithubButton trailingAction={<LogoutButton />} />}
      />
      <SiteSettingsForm initialValues={getSiteSettings()} />
    </div>
  );
}
