import { getSiteSettings } from "@/lib/db";
import SiteSettingsForm from "@/components/admin/SiteSettingsForm";

export const dynamic = "force-dynamic";

export default function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-medium tracking-[0.14em] text-accent">SITE SETTINGS</p>
        <h1 className="mt-1 text-xl font-bold">站点设置</h1>
        <p className="mt-2 text-sm text-neutral-500">修改后会同步到前台页头、页脚与移动端菜单。</p>
      </div>
      <SiteSettingsForm initialValues={getSiteSettings()} />
    </div>
  );
}
