import { requireAdmin } from "@/lib/auth";
import { countPendingComments } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-config";
import AdminShell from "@/components/admin/AdminShell";
import "../admin.css";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <AdminShell host={new URL(getSiteUrl()).host} pendingCount={countPendingComments()}>{children}</AdminShell>;
}
