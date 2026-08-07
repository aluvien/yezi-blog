import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { countPendingComments } from "@/lib/db";
import { AdminNav } from "@/components/admin/AdminNav";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  const pendingCount = countPendingComments();

  return (
    <div className="h-screen overflow-y-auto bg-neutral-50">
      <header className="admin-header sticky top-0 z-10 border-b border-neutral-200 bg-white">
        <div className="admin-header-inner mx-auto flex min-h-14 max-w-[1280px] items-center gap-2 px-3 sm:px-6 lg:px-8">
          <AdminNav pendingCount={pendingCount} />
          <div className="admin-header-actions self-center flex shrink-0 items-center gap-3">
            <span aria-hidden="true" className="admin-header-divider h-6 w-px shrink-0 bg-neutral-200" />
            <Link
              href="/"
              target="_blank"
              rel="noopener noreferrer"
              className="admin-nav-link admin-site-link relative shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] text-neutral-700 transition-colors hover:bg-neutral-100 active:bg-neutral-100 sm:px-3 sm:text-sm"
            >
              网站
            </Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1280px] px-3 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
    </div>
  );
}
