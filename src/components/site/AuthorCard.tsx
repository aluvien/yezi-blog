import { site } from "@/lib/site";

export function AuthorCard() {
  const initial = site.author.charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-4 rounded-xl bg-[#f5f6f7] p-5">
      <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-white">
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-foreground">{site.author}<span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">作者</span></div>
        <div className="mt-1 text-[13px] leading-relaxed text-muted">
          记录文章、想法与作品。感谢你读到这里。
        </div>
      </div>
    </div>
  );
}
