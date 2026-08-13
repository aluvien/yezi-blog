import { articleReferenceCoverSrc, formatArticleReferenceDate } from "@/lib/article-reference";
import type { ReferenceLibraryItem } from "@/lib/db";

export function ReferenceLibraryCard({ reference }: { reference: ReferenceLibraryItem }) {
  const source = reference.source_name || (() => {
    try {
      return new URL(reference.url).hostname;
    } catch {
      return "网页文章";
    }
  })();
  const date = formatArticleReferenceDate(reference.published_at);
  const description = reference.description || reference.summary;

  return (
    <a
      href={reference.url}
      target="_blank"
      rel="noopener noreferrer"
      className="paper-card group flex gap-4 rounded-2xl p-4 no-underline transition-transform duration-300 hover:-translate-y-0.5 sm:gap-5 sm:p-5"
    >
      <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-soft sm:h-24 sm:w-24">
        {reference.cover ? (
          // 引用封面走本站代理，避免访客直接请求第三方图片。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={articleReferenceCoverSrc(reference.cover, reference.url)}
            alt=""
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-2xl font-semibold text-accent/60">引</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] tracking-[0.04em] text-accent">
          <span>{source}</span>
          {reference.author && <span className="text-muted">· {reference.author}</span>}
          {date && <span className="text-muted">· {date}</span>}
        </div>
        <h2 className="mt-2 line-clamp-2 text-[17px] font-semibold leading-6 tracking-[-0.02em] text-foreground transition-colors group-hover:text-accent sm:text-[19px]">
          {reference.title}
        </h2>
        {description && <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-muted">{description}</p>}
        <div className="mt-3 flex items-center justify-between gap-3">
          <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px] ${reference.category ? "bg-accent/10 text-accent" : "bg-soft text-muted"}`}>
            {reference.category || "未分类"}
          </span>
          <span className="shrink-0 text-[12px] text-muted transition-colors group-hover:text-accent">阅读原文 ↗</span>
        </div>
      </div>
    </a>
  );
}
