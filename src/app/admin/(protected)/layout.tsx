import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import LogoutButton from "@/components/admin/LogoutButton";

export const dynamic = "force-dynamic";

const NAV = [
  { href: "/admin", label: "仪表盘" },
  { href: "/admin/posts", label: "文章" },
  { href: "/admin/attachments", label: "附件" },
  { href: "/admin/moments", label: "想法" },
  { href: "/admin/works", label: "作品" },
  { href: "/admin/comments", label: "评论" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();

  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-10 border-b border-neutral-200 bg-white">
        <div className="mx-auto flex min-h-14 max-w-7xl items-center gap-2 px-3 sm:px-6 lg:px-8">
          <Link href="/admin" className="shrink-0 text-sm font-semibold text-neutral-900 sm:mr-2">后台</Link>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="后台导航">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] text-neutral-700 transition-colors hover:bg-neutral-100 active:bg-neutral-100 sm:px-3 sm:text-sm"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="shrink-0">
            <LogoutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-7 lg:px-8">{children}</main>
    </div>
  );
}
