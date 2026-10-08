import { requireAdmin } from "@/lib/auth";
import { countPendingComments, getSiteSettings } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-config";
import { site } from "@/lib/site";
import AdminShell from "@/components/admin/AdminShell";
import "../admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const settings = getSiteSettings();
  return <AdminShell siteName={settings.site_name?.trim() || site.name} host={new URL(getSiteUrl(settings)).host} pendingCount={countPendingComments()}>{children}</AdminShell>;
}
