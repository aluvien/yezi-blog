import { MapPin } from "lucide-react";
import Link from "next/link";
import type { LifeEvent } from "@/lib/db";
import { formatLifeEventDate, lifeEventYear, parseLifeEventImages, normalizeLifeDatePrecision } from "@/lib/life-events";
import { parsePostTags } from "@/lib/post-tags";
import { groupMomentImages } from "@/lib/moments";
import { renderMarkdown } from "@/lib/markdown";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";
import { SiteImage } from "@/components/site/SiteImage";

function LifeEventImages({ images }: { images: string[] }) {
  if (images.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5">
      {groupMomentImages(images).map((row, rowIndex) => (
        <div key={rowIndex} className="flex gap-1.5">
          {row.map((src, index) => (
            <div key={`${src}-${index}`} className="relative min-w-0 flex-1 overflow-hidden rounded-lg bg-soft" style={{ maxWidth: row.length === 1 ? "360px" : undefined }}>
              <SiteImage src={src} alt="" fill sizes="(max-width: 640px) 100vw, 360px" className="h-auto w-full object-cover" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 生活节点单条；供时间轴与统一时间流复用。 */
export function LifeEventEntry({ event }: { event: LifeEvent }) {
  const images = parseLifeEventImages(event.images);
  const tags = parsePostTags(event.tags);
  const date = formatLifeEventDate(event.occurred_at, normalizeLifeDatePrecision(event.date_precision));
  const sourceHref = event.source_type === "moment" && event.source_moment_id ? PUBLIC_ROUTES.moment(event.source_moment_id) : null;

  return (
    <article className="life-event flex gap-4 sm:gap-5">
      <div className="life-event__date shrink-0 text-right">
        <span className="block text-[15px] font-semibold tabular-nums text-foreground">{date}</span>
      </div>
      <div className="min-w-0 flex-1">
        {event.title && <h3 className="text-[17px] font-semibold leading-6 tracking-[-0.02em] text-foreground sm:text-[19px]">{event.title}</h3>}
        {event.content && (
          <div className="mt-1.5 text-[14px] leading-7 text-foreground/90" dangerouslySetInnerHTML={{ __html: renderMarkdown(event.content) }} />
        )}
        <LifeEventImages images={images} />
        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px] text-muted">
          {event.location && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />{event.location}</span>}
          {tags.map((tag) => <span key={tag} className="inline-flex max-w-full items-center rounded-full bg-soft px-2 py-0.5 text-[11px]">#{tag}</span>)}
          {sourceHref && (
            <Link href={sourceHref} className="ml-auto text-muted no-underline transition-colors hover:text-accent">
              来自一条 {event.occurred_at.slice(0, 10)} 的絮语 ↗
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

/** 时间轴：按 occurred_at 年份分段，段内保持调用方传入的时间倒序。 */
export function LifeEventTimeline({ events }: { events: LifeEvent[] }) {
  if (events.length === 0) {
    return <p className="py-16 text-center text-[14px] text-muted">还没有生活节点。</p>;
  }
  const years: Array<{ year: string; items: LifeEvent[] }> = [];
  for (const event of events) {
    const year = lifeEventYear(event.occurred_at);
    const last = years[years.length - 1];
    if (last && last.year === year) last.items.push(event);
    else years.push({ year, items: [event] });
  }
  return (
    <div className="life-timeline flex flex-col gap-9">
      {years.map((group) => (
        <section key={group.year} aria-label={`${group.year} 年`}>
          <div className="mb-4 border-b border-divider pb-2">
            <span className="text-[13px] font-medium tracking-[0.12em] text-accent">{group.year}</span>
          </div>
          <div className="flex flex-col gap-6">
            {group.items.map((event) => <LifeEventEntry key={event.id} event={event} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
