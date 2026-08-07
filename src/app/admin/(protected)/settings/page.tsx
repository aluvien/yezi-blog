import { getSiteSettings } from "@/lib/db";
import LogoutButton from "@/components/admin/LogoutButton";
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";
import SyncGithubButton from "@/components/admin/SyncGithubButton";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium tracking-[0.14em] text-accent">SITE SETTINGS</p>
          <h1 className="mt-1 text-xl font-bold">站点设置</h1>
          <p className="mt-2 text-sm text-neutral-500">集中管理站点信息、个人资料、音乐和文章显示方式。</p>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
          <SyncGithubButton />
          <div className="ml-auto shrink-0">
            <LogoutButton />
          </div>
        </div>
      </div>
      <SiteSettingsForm initialValues={getSiteSettings()} />
    </div>
  );
}
