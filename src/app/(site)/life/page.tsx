import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings, type LifeFeedItem, type ReferenceLibraryItem, type Work } from "@/lib/db";
import { PageHeader } from "@/components/site/PageHeader";
import { SiteImage } from "@/components/site/SiteImage";
import { ReferenceLibraryCard } from "@/components/site/ReferenceLibraryCard";
import { GithubRepositoryCard } from "@/components/site/GithubRepositoryCard";
import { LifeEventEntry, LifeEventTimeline } from "@/components/site/LifeEventTimeline";
import { ClassicLifePage } from "@/components/site/ClassicLifePage";
import {
  LIFE_TABS,
  LIFE_TAB_LABELS,
  getLifeCounts,
  getLifeFeedPage,
  getLifeTabData,
  lifeTabHref,
  normalizeLifeTab,
  type LifeTab,
} from "@/lib/life";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "小记",
  description: "记录经历，也留下做过的事：生活节点、作品、代码与收藏的资料。",
  alternates: { canonical: PUBLIC_ROUTES.life },
};

type SearchParams = { type?: string | string[]; page?: string | string[]; limit?: string | string[] };

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function pageHref(type: LifeTab, page: number): string {
  const base = lifeTabHref(type);
  return page <= 1 ? base : `${base}${base.includes("?") ? "&" : "?"}page=${page}`;
}

function LifeTabs({ active, counts }: { active: LifeTab; counts: Record<LifeTab, number> }) {
  return (
    <nav className="life-tabs" aria-label="小记分类">
      <ul className="flex gap-1.5 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {LIFE_TABS.map((tab) => {
          const isActive = tab === active;
          return (
            <li key={tab} className="shrink-0">
              <Link
                href={lifeTabHref(tab)}
                aria-current={isActive ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] no-underline transition-colors ${
                  isActive ? "bg-foreground text-paper" : "bg-soft text-muted hover:text-foreground"
                }`}
              >
                {LIFE_TAB_LABELS[tab]}
                <span className={isActive ? "text-paper/70" : "text-muted/70"}>{counts[tab]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function LifePager({ type, page, total, limit }: { type: LifeTab; page: number; total: number; limit: number }) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-10 flex items-center justify-between text-sm" aria-label="分页">
      {page > 1
        ? <Link href={pageHref(type, page - 1)} className="rounded-full bg-soft px-4 py-2 text-muted no-underline transition-colors hover:text-foreground">← 上一页</Link>
        : <span className="px-4 py-2 text-muted/40">← 上一页</span>}
      <span className="text-xs text-muted tabular-nums">{page} / {totalPages}</span>
      {page < totalPages
        ? <Link href={pageHref(type, page + 1)} className="rounded-full bg-soft px-4 py-2 text-muted no-underline transition-colors hover:text-foreground">下一页 →</Link>
        : <span className="px-4 py-2 text-muted/40">下一页 →</span>}
    </nav>
  );
}

function WorksGrid({ works }: { works: Work[] }) {
  if (works.length === 0) return <p className="py-16 text-center text-[14px] text-muted">还没有作品。</p>;
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
      {works.map((work, index) => {
        const inner = (
          <article className="paper-card group h-full overflow-hidden rounded-2xl transition-transform duration-300 hover:-translate-y-1">
            {work.cover && work.cover !== "/placeholder.svg" ? (
              <div className="relative aspect-[16/9] w-full overflow-hidden bg-soft">
                <SiteImage src={work.cover} alt={work.title} fill sizes="(max-width: 640px) 100vw, 420px" className="work-cover object-cover" />
              </div>
            ) : (
              <div className="work-cover flex aspect-[16/9] items-center justify-center bg-gradient-to-br from-soft to-paper text-[52px] font-bold text-accent/15">{String(index + 1).padStart(2, "0")}</div>
            )}
            <div className="p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-[20px] font-semibold tracking-[-0.02em]">{work.title}</h2>
                {work.link && <span className="text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent">↗</span>}
              </div>
              {work.description && <p className="mt-2 line-clamp-3 text-[14px] leading-6 text-muted">{work.description}</p>}
            </div>
          </article>
        );
        return work.link ? <a key={work.id} href={work.link} target="_blank" rel="noopener noreferrer">{inner}</a> : <div key={work.id}>{inner}</div>;
      })}
    </div>
  );
}

function ReferenceGrid({ references }: { references: ReferenceLibraryItem[] }) {
  if (references.length === 0) return <p className="py-16 text-center text-[14px] text-muted">还没有收藏引用。</p>;
  return <div className="flex flex-col gap-4">{references.map((reference) => <ReferenceLibraryCard key={reference.id} reference={reference} />)}</div>;
}

/** 统一时间流里的一条：按类型分派到各自的展示形态，全部沿用数据库排好的顺序。 */
function LifeFeedEntry({ item }: { item: LifeFeedItem }) {
  if (item.type === "life_event") return <LifeEventEntry event={item.value} />;
  const date = item.type === "reference"
    ? (item.value.saved_at ?? item.value.created_at).slice(0, 10)
    : item.sort_time.slice(0, 10);
  return (
    <div className="flex gap-4 sm:gap-5">
      <div className="life-event__date shrink-0 text-right">
        <span className="block text-[15px] font-semibold tabular-nums text-foreground">{date}</span>
      </div>
      <div className="min-w-0 flex-1">
        {item.type === "github_repository" && <GithubRepositoryCard repository={item.value} />}
        {item.type === "reference" && <ReferenceLibraryCard reference={item.value} />}
        {item.type === "work" && (
          <article className="paper-card group rounded-2xl p-4 transition-transform duration-300 hover:-translate-y-0.5 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[17px] font-semibold tracking-[-0.02em]">{item.value.title}</h2>
              {item.value.link && <span className="text-muted group-hover:text-accent">↗</span>}
            </div>
            {item.value.description && <p className="mt-2 line-clamp-2 text-[13px] leading-6 text-muted">{item.value.description}</p>}
          </article>
        )}
      </div>
    </div>
  );
}

export default async function LifePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const type = normalizeLifeTab(firstParam(params.type));
  const feedParams = { page: firstParam(params.page) || undefined, limit: firstParam(params.limit) || undefined };

  const classic = getSiteSettings().layout_theme === "classic";
  const counts = getLifeCounts();

  let body: React.ReactNode;
  let pager: React.ReactNode = null;
  let trailing = "";
  let classicItems: LifeFeedItem[] = [];
  let classicPage = 1;
  let classicTotal = 0;
  let classicLimit = 12;

  if (type === "all") {
    const feed = getLifeFeedPage(feedParams);
    trailing = `${feed.total} 条记录`;
    classicItems = feed.items;
    classicPage = feed.page;
    classicTotal = feed.total;
    classicLimit = feed.limit;
    body = feed.items.length === 0
      ? <p className="py-16 text-center text-[14px] text-muted">小记还是空的。</p>
      : <div className="flex flex-col gap-7">{feed.items.map((item) => <LifeFeedEntry key={`${item.type}-${item.id}`} item={item} />)}</div>;
    pager = <LifePager type={type} page={feed.page} total={feed.total} limit={feed.limit} />;
  } else {
    const data = getLifeTabData(type, feedParams);
    trailing = `${data.total} 条`;
    classicPage = data.page;
    classicTotal = data.total;
    classicLimit = data.limit;
    if (type === "milestones") {
      classicItems = data.milestones.map((value) => ({ type: "life_event" as const, id: value.id, sort_time: value.occurred_at, value }));
      body = <LifeEventTimeline events={data.milestones} />;
    } else if (type === "works") {
      classicItems = data.works.map((value) => ({ type: "work" as const, id: value.id, sort_time: value.created_at, value }));
      body = <WorksGrid works={data.works} />;
    } else if (type === "github") {
      classicItems = data.repositories.map((value) => ({ type: "github_repository" as const, id: value.id, sort_time: value.registered_at, value }));
      body = data.repositories.length === 0
      ? <p className="py-16 text-center text-[14px] text-muted">还没有登记 GitHub 仓库。</p>
      : <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{data.repositories.map((repo) => <GithubRepositoryCard key={repo.id} repository={repo} />)}</div>;
    } else {
      classicItems = data.references.map((value) => ({ type: "reference" as const, id: value.id, sort_time: value.saved_at ?? value.created_at, value }));
      body = <ReferenceGrid references={data.references} />;
    }
    pager = <LifePager type={type} page={data.page} total={data.total} limit={data.limit} />;
  }

  if (classic) {
    return <ClassicLifePage active={type} counts={counts} items={classicItems} page={classicPage} total={classicTotal} limit={classicLimit} />;
  }

  const header = <PageHeader eyebrow="LIFE" title="小记" description="生活节点、作品、代码与收藏的资料，汇成一条可以回看的时间流。" trailing={trailing} />;

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      {header}
      <div className="mt-8"><LifeTabs active={type} counts={counts} /></div>
      <div className="mt-8">{body}</div>
      {pager}
    </div>
  );
}
