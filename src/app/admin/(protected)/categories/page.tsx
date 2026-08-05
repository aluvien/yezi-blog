import { listCategories } from "@/lib/db";
import { createCategoryAction, deleteCategoryAction } from "@/lib/actions/settings";

export const dynamic = "force-dynamic";

export default function AdminCategoriesPage() {
  const categories = listCategories();
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-xs font-medium tracking-[0.14em] text-accent">CONTENT INDEX</p>
        <h1 className="mt-1 text-xl font-bold">分类管理</h1>
        <p className="mt-2 text-sm text-neutral-500">分类用于文章索引；删除分类不会删除文章，只会清空文章分类。</p>
      </div>
      <form action={createCategoryAction} className="flex max-w-xl gap-2 rounded-2xl bg-white p-4 shadow-sm">
        <input name="name" required maxLength={80} className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2" placeholder="新增分类，例如：技术" />
        <button className="shrink-0 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">新增</button>
      </form>
      <div className="max-w-xl overflow-hidden rounded-2xl bg-white shadow-sm">
        {categories.length === 0 ? <p className="p-5 text-sm text-neutral-500">暂时没有分类。</p> : (
          <ul className="divide-y divide-neutral-100">
            {categories.map((category) => (
              <li key={category.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div><p className="text-sm font-medium text-neutral-800">{category.name}</p><p className="text-xs text-neutral-400">/{category.slug}</p></div>
                <form action={deleteCategoryAction}><input type="hidden" name="id" value={category.id} /><button className="text-xs text-red-600 hover:underline">删除</button></form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
