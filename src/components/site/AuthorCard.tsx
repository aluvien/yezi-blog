import { site } from "@/lib/site";
import { SiteImage } from "@/components/site/SiteImage";

export function AuthorCard({ authorName = site.author, avatar, avatarNoBorder = false }: { authorName?: string; avatar?: string | null; avatarNoBorder?: boolean }) {
  const initial = authorName.charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-4 rounded-xl bg-soft p-5">
      {avatar ? (
        <div className={`relative h-13 w-13 shrink-0 overflow-hidden rounded-xl ${avatarNoBorder ? "" : "border border-divider"}`}>
          <SiteImage src={avatar} alt="" fill sizes="52px" className="object-cover" />
        </div>
      ) : (
        <div className="flex h-13 w-13 shrink-0 items-center justify-center rounded-xl bg-accent text-lg font-semibold text-white">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[15px] font-semibold text-foreground">{authorName}<span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">作者</span></div>
        <div className="mt-1 text-[13px] leading-relaxed text-muted">
          记录文章、想法与作品。感谢你读到这里。
        </div>
      </div>
    </div>
  );
}
