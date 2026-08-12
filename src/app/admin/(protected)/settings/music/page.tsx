import AdminPageHeader from "@/components/admin/AdminPageHeader";
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";
import { getSiteSettings } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function AdminMusicSettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader
        eyebrow="MUSIC SETTINGS"
        title="音乐设置"
        description="管理 QQ 音乐登录、默认歌单与前台播放器的展示方式。"
      />
      <SiteSettingsForm initialValues={getSiteSettings()} section="music" />
    </div>
  );
}
