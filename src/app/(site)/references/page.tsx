import type { Metadata } from "next";
import { listReferenceLibrary, listReferenceLibraryCategories } from "@/lib/db";
import { PageHeader } from "@/components/site/PageHeader";
import { ReferenceLibraryCard } from "@/components/site/ReferenceLibraryCard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "引用",
  description: "收藏一些值得回看的文章、网页和灵感。",
};

type SearchParams = { q?: string | string[]; category?: string | string[] };

function firstParam(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

export default async function ReferencesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const keyword = firstParam(params.q).slice(0, 120);
  const category = firstParam(params.category).slice(0, 80);
  const references = listReferenceLibrary({ keyword, category });
  const categories = listReferenceLibraryCategories();
  const uncategorizedCount = listReferenceLibrary({ category: "__uncategorized" }).length;

  return (
    <div className="mx-auto max-w-[860px] py-8 md:py-12">
      <PageHeader
        eyebrow="ARTICLE REFERENCES"
        title="引用"
        description="收藏一些值得回看的文章、网页和灵感，不必为了保存它们而写进文章。"
        trailing={`${references.length} 条`}
      />

      <form method="get" className="mb-7 flex flex-col gap-2.5 rounded-2xl bg-soft/60 p-3 sm:flex-row sm:items-center">
        <label htmlFor="reference-search" className="sr-only">搜索引用</label>
        <input
          id="reference-search"
          name="q"
          defaultValue={keyword}
          placeholder="搜索标题、来源、作者或摘要"
          className="min-w-0 flex-1 rounded-xl border border-divider bg-paper px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/15"
        />
        <label htmlFor="reference-category" className="sr-only">按分类筛选</label>
        <select
          id="reference-category"
          name="category"
          defaultValue={category}
          className="rounded-xl border border-divider bg-paper px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/15"
        >
          <option value="">全部分类</option>
          {uncategorizedCount > 0 && <option value="__uncategorized">未分类（{uncategorizedCount}）</option>}
          {categories.map((item) => <option key={item.category} value={item.category}>{item.category}（{item.count}）</option>)}
        </select>
        <button type="submit" className="rounded-xl bg-foreground px-4 py-2.5 text-sm font-medium text-paper transition-colors hover:bg-accent">搜索</button>
        {(keyword || category) && <a href="/references" className="px-1 text-center text-sm text-muted no-underline transition-colors hover:text-accent">清除</a>}
      </form>

      {references.length > 0 ? (
        <div className="flex flex-col gap-4">
          {references.map((reference) => <ReferenceLibraryCard key={reference.id} reference={reference} />)}
        </div>
      ) : (
        <div className="py-20 text-center text-[14px] text-muted">
          <p>{keyword || category ? "没有找到符合条件的收藏。" : "还没有收藏文章。"}</p>
          {(keyword || category) && <a href="/references" className="mt-3 inline-flex text-accent no-underline hover:underline">查看全部收藏</a>}
        </div>
      )}
    </div>
  );
}
