import { listAllTags, listCategories } from "@/lib/db";
import TaxonomyManager from "@/components/admin/TaxonomyManager";

export const dynamic = "force-dynamic";

export default function AdminCategoriesPage() {
  const categories = listCategories();
  const tags = listAllTags();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-medium tracking-[0.14em] text-accent">CONTENT INDEX</p>
        <h1 className="mt-1 text-xl font-bold">分类与标签</h1>
        <p className="mt-2 text-sm text-neutral-500">分类和标签集中管理；删除分类不会删除文章，只会清空对应索引。</p>
      </div>
      <TaxonomyManager categories={categories} tags={tags} />
    </div>
  );
}
