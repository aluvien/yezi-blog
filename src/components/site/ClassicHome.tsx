import Link from "next/link";
import type { FeedItem } from "@/lib/mobile-feed";
import { formatDateOnly } from "@/lib/format";
import { parsePostTags } from "@/lib/post-tags";
import type { Work } from "@/lib/db/types";
import { ClassicHomeFeed } from "@/components/site/ClassicHomeFeed";
import { PUBLIC_ROUTES } from "@/lib/site-navigation";

function tagsFor(item: FeedItem): string[] {
  // Archive metadata should mirror the article header and use the dedicated
  // tags field. The category is only a compatibility fallback for records
  // created before tags were stored separately.
  return item.type === "post" ? parsePostTags(item.value.tags || item.value.category || "").slice(0, 3) : [];
}

export function ClassicArchiveList({ items }: { items: FeedItem[] }) {
  const posts = items.filter((item): item is Extract<FeedItem, { type: "post" }> => item.type === "post");
  const years = Array.from(new Set(posts.map((item) => item.value.created_at.slice(0, 4))));
  return (
    <>
      {years.map((year) => (
        <section key={year} data-entry-section>
          <h2 className="archive-year">{year}</h2>
          <div className="archive-list">
            {posts.filter((item) => item.value.created_at.startsWith(year)).map((item) => {
              const tags = tagsFor(item);
              const date = formatDateOnly(item.value.created_at);
              return (
                <div className="archive-row" key={item.value.id} data-entry-item data-search={`${item.value.title} ${tags.join(" ")}`} data-slug={item.value.slug}>
                  <div className="archive-title"><Link href={PUBLIC_ROUTES.post(item.value.slug)}>{item.value.title}</Link></div>
                  <div className="archive-meta">
                    <div className="archive-date"><span className="archive-date-md">{date.slice(5)}</span><span className="archive-date-full">{date}</span></div>
                    {tags.length > 0 ? <div className="archive-tag">
                      {tags.map((tag) => <Link className="tag" href={PUBLIC_ROUTES.tag(tag)} key={tag}>#{tag}</Link>)}
                    </div> : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}

export function ClassicHome({ items, siteName, heroSrc, homeIntro, homeMore, homeSectionTitle, includeBits = true, authorName, authorAvatar }: { items: FeedItem[]; siteName: string; heroSrc?: string; homeIntro?: string; homeMore?: string; homeSectionTitle?: string; includeBits?: boolean; authorName: string; authorAvatar?: string }) {
  const hero = heroSrc?.trim();
  const intro = homeIntro?.trim();
  const more = homeMore?.trim();
  return (
    <>
      <h1 className="sr-only">{siteName}</h1>
      {hero ? <div className="hero">
        {/* The reference theme intentionally uses a plain, cover-cropped hero image. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={hero} alt={`${siteName} theme preview`} loading="eager" />
      </div> : null}
      {intro || more ? <div className="intro intro--serif">
        {intro ? <span className="intro__lead">{intro}</span> : null}
        {more ? <span className="intro__more">{more}</span> : null}
      </div> : null}
      {homeSectionTitle?.trim() ? <h2 className="section-title section-title--index">{homeSectionTitle.trim()}</h2> : null}
      <ClassicHomeFeed items={includeBits ? items : items.filter((item) => item.type === "post")} authorName={authorName} authorAvatar={authorAvatar} />
    </>
  );
}

/** 目标主题的小记是目录 + Markdown 正文；作品数据沿用本站原有内容。 */
export function ClassicMemoPage({ works }: { works: Work[] }) {
  return (
    <>
      <div className="page-header reader-exit-anchor">
        <h1 className="page-title">生活小记</h1>
        <span className="page-subtitle">不曾虚度的光</span>
      </div>
      <div className="intro prose">时间流经我们，如同风穿过回廊。总有一些片刻，携带着特别的气息或光亮，短暂停留后便消散。为它们留下一份文字备份，是抵抗遗忘最温柔的方式。</div>
      <nav className="memo-toc" aria-label="目录">
        <details open>
          <summary>目录</summary>
          <ul className="toc-items">
            {works.map((work, index) => <li key={work.id}><a href={`#work-${work.id}`}><span className="toc-num">{index + 1}</span><span>{work.title}</span></a></li>)}
          </ul>
        </details>
      </nav>
      <div className="memo-content prose">
        <h2>片刻与记录</h2>
        {works.length === 0 ? <p>还没有可留存的记录。</p> : works.map((work, index) => (
          <section key={work.id} id={`work-${work.id}`}>
            <h3 data-num={index + 1}>{work.link ? <a href={work.link} target="_blank" rel="noopener noreferrer">{work.title} <span aria-hidden="true">↗</span></a> : work.title}</h3>
            {work.description ? <p>{work.description}</p> : null}
          </section>
        ))}
      </div>
    </>
  );
}
