import type { ReferenceLibraryItem } from "@/lib/db";
import { parsePostTags } from "@/lib/post-tags";
import { ArrowUpRight } from "lucide-react";

type ReferenceLabel = {
  label: string;
  kind: "category" | "tag";
};

function referenceCategory(reference: ReferenceLibraryItem): string {
  const category = reference.category.trim();
  return /^(未分类|uncategorized|unknown)$/i.test(category) ? "" : category;
}

function referenceLabels(reference: ReferenceLibraryItem): ReferenceLabel[] {
  const category = referenceCategory(reference);
  const labels: ReferenceLabel[] = category ? [{ label: category, kind: "category" }] : [];
  const seen = new Set(labels.map((label) => label.label.toLocaleLowerCase()));
  for (const tag of parsePostTags(reference.tags)) {
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    labels.push({ label: tag, kind: "tag" });
  }
  return labels;
}

function referenceSummary(reference: ReferenceLibraryItem): string {
  return reference.summary.trim() || reference.description.trim() || "这条收藏还没有生成 AI 摘要。";
}

function referenceTitle(reference: ReferenceLibraryItem): string {
  return reference.title.trim() || "未命名收藏";
}

function referenceTaxonomy(references: ReferenceLibraryItem[]): ReferenceLabel[] {
  const labels: ReferenceLabel[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    for (const label of referenceLabels(reference)) {
      const key = `${label.kind}:${label.label.toLocaleLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      labels.push(label);
    }
  }
  return labels;
}

function referenceLabelCounts(references: ReferenceLibraryItem[], label: ReferenceLabel): number {
  return references.reduce((count, reference) => (
    referenceLabels(reference).some((item) => item.kind === label.kind && item.label.toLocaleLowerCase() === label.label.toLocaleLowerCase())
      ? count + 1
      : count
  ), 0);
}

function ClassicReferenceTaxonomy({ references }: { references: ReferenceLibraryItem[] }) {
  const labels = referenceTaxonomy(references);
  if (labels.length < 2) return null;

  return (
    <div className="classic-reference-taxonomy" aria-label="收藏分类与标签">
      <span className="classic-reference-taxonomy__label">分类与标签</span>
      <div className="classic-reference-taxonomy__items">
        {labels.map((label) => (
          <span className={`classic-reference-taxonomy__item classic-reference-taxonomy__item--${label.kind}`} key={`${label.kind}-${label.label}`}>
            {label.kind === "tag" ? `#${label.label}` : label.label}
            <small>{referenceLabelCounts(references, label)}</small>
          </span>
        ))}
      </div>
    </div>
  );
}

function ClassicReferenceItem({ reference }: { reference: ReferenceLibraryItem }) {
  const title = referenceTitle(reference);
  const summary = referenceSummary(reference);
  const tooltipId = `classic-reference-summary-${reference.id}`;
  const labels = referenceLabels(reference);
  const category = labels.find((label) => label.kind === "category");
  const tags = labels.filter((label) => label.kind === "tag");

  return (
    <li className="classic-reference-item">
      {category || tags.length > 0 ? (
        <div className="classic-reference-item__labels" aria-label="收藏分类与标签">
          {category ? <span className="classic-reference-item__category">{category.label}</span> : null}
          {tags.map((tag) => <span className="classic-reference-item__tag" key={tag.label}>#{tag.label}</span>)}
        </div>
      ) : null}
      <span className="site-article-reference classic-reference-item__link-shell">
        <a
          className="site-article-reference-link classic-reference-item__link"
          href={reference.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-describedby={tooltipId}
        >
          <span className="classic-reference-item__title">{title}</span>
          <ArrowUpRight className="classic-reference-item__external" aria-hidden="true" size={15} strokeWidth={1.8} />
        </a>
        <span id={tooltipId} className="site-article-reference-tooltip classic-reference-item__tooltip" role="tooltip">
          <span className="classic-reference-item__tooltip-label">AI 摘要</span>
          <span>{summary}</span>
        </span>
      </span>
    </li>
  );
}

/** 经典版收藏引用：分类标签 + 简洁标题，摘要仅在标题附近轻量提示。 */
export function ClassicReferenceList({ references }: { references: ReferenceLibraryItem[] }) {
  return (
    <section className="classic-reference-list" aria-label="收藏引用">
      <ClassicReferenceTaxonomy references={references} />
      {references.length === 0 ? (
        <p className="classic-reference-empty">还没有收藏引用。</p>
      ) : (
        <ul className="classic-reference-items">
          {references.map((reference) => <ClassicReferenceItem key={reference.id} reference={reference} />)}
        </ul>
      )}
    </section>
  );
}
