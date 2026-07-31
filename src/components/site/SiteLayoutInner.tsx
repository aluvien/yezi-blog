"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { site } from "@/lib/site";
import { TopNav, BottomTabNav } from "@/components/site/SiteNav";

export function SiteLayoutInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPost = pathname.startsWith("/posts/");

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="hidden border-b border-black/[0.06] bg-white/95 backdrop-blur md:sticky md:top-0 md:z-40 md:block">
        <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center justify-between px-4 md:px-6">
          <Link href="/" className="group flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-accent text-[16px] font-bold text-white shadow-sm shadow-accent/20 transition-transform group-hover:-rotate-3">
              {site.author.charAt(0).toUpperCase()}
            </span>
            <span>
              <span className="block text-[16px] font-semibold leading-none tracking-tight">{site.author}</span>
              <span className="mt-1 hidden text-[10px] leading-none tracking-[0.16em] text-muted sm:block">ARTICLES &amp; IDEAS</span>
            </span>
          </Link>
          <TopNav />
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 ${isPost ? "max-w-[960px] px-0 pb-36 md:px-4 md:pb-20 md:pt-8" : "max-w-[1080px] px-4 pb-24 md:px-6 md:pb-16"}`}>
        {children}
      </main>
      {!isPost && (
        <footer className="border-t border-divider bg-white pb-20 md:pb-0">
          <div className="mx-auto flex w-full max-w-[1080px] flex-col items-center justify-between gap-2 px-6 py-7 text-xs text-muted sm:flex-row">
            <span>© {new Date().getFullYear()} {site.author}</span>
            <span>认真写字，也认真生活。</span>
          </div>
        </footer>
      )}
      <BottomTabNav />
    </div>
  );
}
