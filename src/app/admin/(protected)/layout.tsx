import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { countPendingComments } from "@/lib/db";
import LogoutButton from "@/components/admin/LogoutButton";
import { AdminNav } from "@/components/admin/AdminNav";
import SyncGithubButton from "@/components/admin/SyncGithubButton";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const pendingCount = countPendingComments();

  return (
    <div className="h-screen overflow-y-auto bg-neutral-50">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex min-h-14 max-w-[1280px] items-center gap-2 px-3 sm:px-6 lg:px-8">
          <AdminNav pendingCount={pendingCount} />
          <div className="flex shrink-0 items-center gap-3">
            <SyncGithubButton />
            <Link href="/" target="_blank" rel="noopener noreferrer" className="text-sm text-neutral-500 transition-colors hover:text-neutral-900">网站</Link>
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
    </div>
  );
}
