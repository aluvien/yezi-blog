import { getSiteUrl } from "@/lib/site-config";
import { getSiteSettings } from "@/lib/db";
import LogoutButton from "@/components/admin/LogoutButton";
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";
import SyncGithubButton from "@/components/admin/SyncGithubButton";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  const settings = getSiteSettings();
  return (
    <div className="admin-page flex flex-col gap-5">
      <AdminPageHeader
        eyebrow="SITE SETTINGS"
        title="站点设置"
        description="集中管理站点信息、个人资料、社交信息与 Telegram 通知。"
        actions={<SyncGithubButton trailingAction={<LogoutButton />} />}
      />
      <SiteSettingsForm initialValues={{ ...settings, site_url: getSiteUrl(settings) }} section="site" />
    </div>
  );
}
