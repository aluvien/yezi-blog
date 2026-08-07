import type { Metadata } from "next";
import { listWorks } from "@/lib/db";
import { PageHeader } from "@/components/site/PageHeader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "作品",
  description: "做过的一些作品与项目。",
};

export default function WorksPage() {
  const works = listWorks();

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <PageHeader
        eyebrow="精选作品"
        title="作品"
        description="把想法做成可以使用的东西，也记录从尝试到完成的过程。"
        trailing={`${works.length} 个项目`}
      />

      {works.length === 0 && <p className="py-20 text-center text-[14px] text-muted">还没有作品。</p>}
      <div className="mt-9 grid grid-cols-1 gap-5 sm:grid-cols-2">
        {works.map((work, index) => {
          const inner = (
            <article className="paper-card group h-full overflow-hidden rounded-2xl transition-transform duration-300 hover:-translate-y-1">
              {work.cover && work.cover !== "/placeholder.svg" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={work.cover} alt={work.title} loading="lazy" className="work-cover aspect-[16/9] w-full bg-neutral-100 object-cover" />
              ) : (
                <div className="work-cover flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-[#edf9f3] to-[#e9eef7] text-[52px] font-bold text-accent/15">{String(index + 1).padStart(2, "0")}</div>
              )}
              <div className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{work.title}</h2>
                  {work.link && <span className="text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent">↗</span>}
                </div>
                {work.description && <p className="mt-2 line-clamp-3 text-[14px] leading-6 text-muted">{work.description}</p>}
                <p className="mt-5 text-[11px] tracking-[0.12em] text-muted">项目 {String(index + 1).padStart(2, "0")}</p>
              </div>
            </article>
          );
          return work.link ? <a key={work.id} href={work.link} target="_blank" rel="noopener noreferrer">{inner}</a> : <div key={work.id}>{inner}</div>;
        })}
      </div>
    </div>
  );
}
