import Link from "next/link";
import { ArrowUpRight, MapPin } from "lucide-react";
import type { LifeFeedItem, ReferenceLibraryItem } from "@/lib/db";
import { articleReferenceCoverSrc, formatArticleReferenceDate } from "@/lib/article-reference";
import { formatLifeEventDate, normalizeLifeDatePrecision, parseLifeEventImages } from "@/lib/life-events";
import { parsePostTags } from "@/lib/post-tags";
import { renderMarkdown } from "@/lib/markdown";
import { groupMomentImages } from "@/lib/moments";
import { githubDisplayDescription, githubDisplayTitle, parseGithubTopics } from "@/lib/github-presentation";
import { LIFE_TABS, LIFE_TAB_LABELS, lifeTabHref, type LifeTab } from "@/lib/life";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";
import { SiteImage } from "@/components/site/SiteImage";
import { ClassicReferenceList } from "@/components/site/ClassicReferenceList";

type ClassicLifePageProps = {
  active: LifeTab;
  counts: Record<LifeTab, number>;
  items: LifeFeedItem[];
  page: number;
  total: number;
  limit: number;
};

const CLASSIC_LIFE_INTRO = [
  "时间流经我们，如同风穿过回廊。",
  "为值得记下的片刻，留一份文字备份。",
];

function itemTitle(item: LifeFeedItem): string {
  if (item.type === "life_event") return item.value.title.trim() || "生活节点";
  if (item.type === "work") return item.value.title.trim() || "未命名作品";
  if (item.type === "github_repository") return githubDisplayTitle(item.value).trim() || item.value.full_name;
  return item.value.title.trim() || "收藏引用";
}

function referenceSummary(reference: ReferenceLibraryItem): string {
  return reference.summary.trim() || reference.description.trim() || "这条收藏还没有生成 AI 摘要。";
}

function itemKind(item: LifeFeedItem): string {
  if (item.type === "life_event") return "生活节点";
  if (item.type === "work") return "作品";
  if (item.type === "github_repository") return "GitHub";
  return "收藏引用";
}

function itemDate(item: LifeFeedItem): string {
  if (item.type === "life_event") {
    return formatLifeEventDate(item.value.occurred_at, normalizeLifeDatePrecision(item.value.date_precision));
  }
  if (item.type === "reference") {
    const formatted = formatArticleReferenceDate(item.value.saved_at ?? item.value.created_at);
    return /^\d{4}-\d{2}-\d{2}/.test(formatted) ? formatted.slice(0, 10) : formatted;
  }
  return item.sort_time.slice(0, 10);
}

function itemHref(item: LifeFeedItem): string | null {
  if (item.type === "life_event") {
    return item.value.source_type === "moment" && item.value.source_moment_id
      ? PUBLIC_ROUTES.moment(item.value.source_moment_id)
      : null;
  }
  if (item.type === "work") return item.value.link || null;
  if (item.type === "github_repository") return item.value.repo_url || null;
  return item.value.url || null;
}

function ClassicLifeEntryTitle({ item }: { item: LifeFeedItem }) {
  const title = itemTitle(item);
  const href = itemHref(item);
  if (!href) return title;
  return (
    <a href={href} target={item.type === "life_event" ? undefined : "_blank"} rel={item.type === "life_event" ? undefined : "noopener noreferrer"}>
      {title} <span className="classic-life-entry__external" aria-hidden="true">↗</span>
    </a>
  );
}

function itemAnchor(item: LifeFeedItem): string {
  return `life-${item.type.replace(/_/g, "-")}-${item.id}`;
}

function ClassicLifeTabs({ active, counts }: Pick<ClassicLifePageProps, "active" | "counts">) {
  return (
    <nav className="life-tabs life-tabs--classic" aria-label="小记分类">
      <ul>
        {LIFE_TABS.map((tab) => {
          const selected = tab === active;
          return (
            <li key={tab}>
              <Link href={lifeTabHref(tab)} aria-current={selected ? "page" : undefined} className={selected ? "is-active" : undefined}>
                <span>{LIFE_TAB_LABELS[tab]}</span>
                <span className="life-tabs__count">{counts[tab]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ClassicLifeMedia({ item }: { item: LifeFeedItem }) {
  const images: string[] = [];
  if (item.type === "life_event") {
    if (item.value.cover) images.push(item.value.cover);
    images.push(...parseLifeEventImages(item.value.images));
  } else if (item.type === "work") {
    if (item.value.cover && item.value.cover !== "/placeholder.svg") images.push(item.value.cover);
  } else if (item.type === "github_repository") {
    if (item.value.cover) images.push(item.value.cover);
  } else if (item.value.cover) {
    images.push(articleReferenceCoverSrc(item.value.cover, item.value.url));
  }

  const uniqueImages = [...new Set(images.filter(Boolean))].slice(0, 9);
  if (uniqueImages.length === 0) return null;
  const rows = groupMomentImages(uniqueImages);
  return (
    <div className="classic-life-entry__media" aria-label="相关图片">
      {rows.map((row, rowIndex) => (
        <div className="classic-life-entry__media-row" key={rowIndex}>
          {row.map((src, index) => (
            <div className="classic-life-entry__media-item" key={`${src}-${index}`}>
              <SiteImage src={src} alt="" fill sizes="(max-width: 640px) 100vw, 760px" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ClassicLifeEntryBody({ item }: { item: LifeFeedItem }) {
  if (item.type === "life_event") {
    if (!item.value.content.trim()) return null;
    return <div className="classic-life-entry__markdown" dangerouslySetInnerHTML={{ __html: renderMarkdown(item.value.content) }} />;
  }

  if (item.type === "reference") {
    const description = item.value.description.trim() || item.value.summary.trim();
    return description ? <p>{description}</p> : null;
  }

  const description = item.type === "github_repository"
    ? githubDisplayDescription(item.value).trim()
    : item.value.description.trim();
  return description ? <p>{description}</p> : null;
}

function ClassicLifeEntryMeta({ item, includeDate = true }: { item: LifeFeedItem; includeDate?: boolean }) {
  const tags = item.type === "life_event"
    ? parsePostTags(item.value.tags)
    : item.type === "reference"
      ? parsePostTags(item.value.tags)
      : item.type === "github_repository"
        ? [...parsePostTags(item.value.tags), ...parseGithubTopics(item.value)]
        : [];
  const source = item.type === "reference"
    ? item.value.source_name || "网页文章"
    : item.type === "github_repository"
      ? item.value.full_name
      : item.type === "life_event" && item.value.source_type === "moment"
        ? "来自絮语"
        : "";

  return (
    <div className="classic-life-entry__meta">
      {includeDate ? <time dateTime={item.sort_time}>{itemDate(item)}</time> : null}
      <span>{itemKind(item)}</span>
      {source ? <span>{source}</span> : null}
      {item.type === "life_event" && item.value.location ? (
        <span className="classic-life-entry__location"><MapPin aria-hidden="true" size={13} strokeWidth={1.8} />{item.value.location}</span>
      ) : null}
      {tags.slice(0, 8).map((tag) => <span key={tag}>#{tag}</span>)}
    </div>
  );
}

function ClassicLifeEntry({ item, index, compact = false }: { item: LifeFeedItem; index: number; compact?: boolean }) {
  return (
    <section id={itemAnchor(item)} className={`classic-life-entry${compact ? " classic-life-entry--flat" : ""}`}>
      <h3 data-num={compact ? undefined : index + 1}><ClassicLifeEntryTitle item={item} /></h3>
      <ClassicLifeEntryBody item={item} />
      <ClassicLifeMedia item={item} />
      <ClassicLifeEntryMeta item={item} />
    </section>
  );
}

function ClassicLifeDetailList({ items }: { items: LifeFeedItem[] }) {
  return (
    <div className="memo-content prose classic-life-content classic-life-content--detail">
      {items.length === 0 ? (
        <p className="classic-life-empty">还没有可留存的记录。</p>
      ) : (
        <div className="classic-life-detail-list">
          {items.map((item, index) => <ClassicLifeEntry key={`${item.type}-${item.id}`} item={item} index={index} compact />)}
        </div>
      )}
    </div>
  );
}

function referenceTimelineKind(reference: ReferenceLibraryItem): string {
  const category = reference.category.trim();
  if (category && !/^(未分类|uncategorized|unknown)$/i.test(category)) return category;
  const firstTag = parsePostTags(reference.tags)[0]?.trim();
  return firstTag ? `#${firstTag}` : "收藏引用";
}

function ClassicLifeTimelineTitle({ item }: { item: LifeFeedItem }) {
  const title = itemTitle(item);
  const href = itemHref(item);
  const titleContent = <span className="classic-life-timeline__title">{title}</span>;
  const linkedTitle = href ? (
    <a href={href} target={item.type === "life_event" ? undefined : "_blank"} rel={item.type === "life_event" ? undefined : "noopener noreferrer"}>
      {titleContent}
      <span className="classic-life-entry__external" aria-hidden="true">↗</span>
    </a>
  ) : titleContent;

  return (
    <>
      <span className="classic-life-timeline__kind">{itemKind(item)}</span>
      <span className="classic-life-timeline__separator" aria-hidden="true">·</span>
      {linkedTitle}
    </>
  );
}

function ClassicLifeReferenceTimelineLine({ reference }: { reference: ReferenceLibraryItem }) {
  const title = reference.title.trim() || "未命名收藏";
  const summary = referenceSummary(reference);
  const tooltipId = `classic-life-reference-summary-${reference.id}`;

  return (
    <div className="classic-life-reference-line">
      <span className="classic-life-reference-line__kind">{referenceTimelineKind(reference)}</span>
      <span className="classic-life-reference-line__separator" aria-hidden="true">·</span>
      <span className="site-article-reference classic-life-reference-line__link-shell">
        <a
          className="site-article-reference-link classic-life-reference-line__link"
          href={reference.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={tooltipId}
        >
          <span className="classic-life-reference-line__title">{title}</span>
          <ArrowUpRight className="classic-life-reference-line__external" aria-hidden="true" size={15} strokeWidth={1.8} />
        </a>
        <span id={tooltipId} className="site-article-reference-tooltip classic-life-reference-line__tooltip" role="tooltip">
          <span className="classic-life-reference-line__tooltip-label">AI 摘要</span>
          <span>{summary}</span>
        </span>
      </span>
    </div>
  );
}

function ClassicLifeTimelineItem({ item }: { item: LifeFeedItem }) {
  const date = itemDate(item);
  return (
    <article id={itemAnchor(item)} className={`classic-life-timeline__item classic-life-timeline__item--${item.type}`}>
      <time className="classic-life-timeline__date" dateTime={item.sort_time}>
        {date}
      </time>
      <div className="classic-life-timeline__content">
        {item.type === "reference" ? (
          <ClassicLifeReferenceTimelineLine reference={item.value} />
        ) : (
          <h3><ClassicLifeTimelineTitle item={item} /></h3>
        )}
      </div>
    </article>
  );
}

function ClassicLifeFlatList({ items }: { items: LifeFeedItem[] }) {
  return (
    <div className="memo-content prose classic-life-content classic-life-content--flat">
      {items.length === 0 ? <p className="classic-life-empty">还没有可留存的记录。</p> : (
        <div className="classic-life-timeline" aria-label="全部小记时间轴">
          {items.map((item) => <ClassicLifeTimelineItem key={`${item.type}-${item.id}`} item={item} />)}
        </div>
      )}
    </div>
  );
}

function classicPageHref(active: LifeTab, page: number): string {
  const base = lifeTabHref(active);
  return page <= 1 ? base : `${base}${base.includes("?") ? "&" : "?"}page=${page}`;
}

function ClassicLifePager({ active, page, total, limit }: Pick<ClassicLifePageProps, "active" | "page" | "total" | "limit">) {
  const totalPages = Math.ceil(total / limit);
  if (totalPages <= 1) return null;
  return (
    <nav className="classic-life-pager" aria-label="小记分页">
      {page > 1 ? <Link href={classicPageHref(active, page - 1)}>← 上一页</Link> : <span>← 上一页</span>}
      <span className="classic-life-pager__current">{page} / {totalPages}</span>
      {page < totalPages ? <Link href={classicPageHref(active, page + 1)}>下一页 →</Link> : <span>下一页 →</span>}
    </nav>
  );
}

export function ClassicLifePage({ active, counts, items, page, total, limit }: ClassicLifePageProps) {
  const isReferences = active === "references";
  const isAll = active === "all";
  const references = isReferences
    ? items.flatMap((item) => item.type === "reference" ? [item.value] : [])
    : [];
  return (
    <div className="classic-life-page">
      <div className="page-header reader-exit-anchor">
        <h1 className="page-title">生活小记</h1>
        <span className="page-subtitle">不曾虚度的光</span>
      </div>

      <div className="intro prose classic-life-intro">
        <p>{CLASSIC_LIFE_INTRO.map((line, index) => <span key={line}>{index > 0 ? <br /> : null}{line}</span>)}</p>
      </div>

      <ClassicLifeTabs active={active} counts={counts} />

      {isReferences ? (
        <ClassicReferenceList references={references} />
      ) : isAll ? (
        <ClassicLifeFlatList items={items} />
      ) : (
        <ClassicLifeDetailList items={items} />
      )}

      <ClassicLifePager active={active} page={page} total={total} limit={limit} />
    </div>
  );
}
