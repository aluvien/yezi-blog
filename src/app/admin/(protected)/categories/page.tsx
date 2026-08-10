import { listAllTags, listCategories } from "@/lib/db";
import TaxonomyManager from "@/components/admin/TaxonomyManager";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default function AdminCategoriesPage() {
  const categories = listCategories();
  const tags = listAllTags();
  return (
    <div className="flex flex-col gap-5">
      <AdminPageHeader eyebrow="CONTENT INDEX" title="分类与标签" description="分类和标签集中管理；删除分类不会删除文章，只会清空对应索引。" />
      <TaxonomyManager categories={categories} tags={tags} />
    </div>
  );
}
