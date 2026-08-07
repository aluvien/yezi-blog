"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Category } from "@/lib/db";
import {
  createCategoryAction,
  deleteCategoryByIdAction,
  deleteTagAction,
  renameTagAction,
  updateCategoryAction,
} from "@/lib/actions/settings";
import DeleteButton from "@/components/admin/DeleteButton";

type TagItem = { tag: string; count: number };
type EditingItem = { kind: "category"; id: number } | { kind: "tag"; tag: string } | null;

type Props = {
  categories: Category[];
  tags: TagItem[];
};

export default function TaxonomyManager({ categories, tags }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<EditingItem>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function beginEdit(item: EditingItem, value: string) {
    setEditing(item);
    setDraft(value);
    setError("");
  }

  function cancelEdit() {
    setEditing(null);
    setDraft("");
    setError("");
  }

  function saveCategory(category: Category) {
    startTransition(async () => {
      const result = await updateCategoryAction(category.id, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      cancelEdit();
      router.refresh();
    });
  }

  function saveTag(tag: string) {
    startTransition(async () => {
      const result = await renameTagAction(tag, draft);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      cancelEdit();
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-accent">CATEGORIES</p>
            <h2 className="mt-1 text-lg font-bold">分类管理</h2>
            <p className="mt-1 text-sm text-neutral-500">分类改名会同步更新文章中的所属分类。</p>
          </div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-500">{categories.length} 个</span>
        </div>

        <form action={createCategoryAction} className="mt-5 flex max-w-xl gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <input name="name" required maxLength={80} className="min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm" placeholder="新增分类，例如：技术" />
          <button className="shrink-0 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-700">新增</button>
        </form>

        {error && <p className="mt-3 text-sm text-red-600" aria-live="polite">{error}</p>}
        {categories.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-400">暂时没有分类。</p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-100">
            {categories.map((category) => {
              const isEditing = editing?.kind === "category" && editing.id === category.id;
              return (
                <li key={category.id} className="flex min-h-16 flex-col justify-center gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  {isEditing ? (
                    <form
                      className="flex min-w-0 flex-1 flex-wrap gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveCategory(category);
                      }}
                    >
                      <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={80} className="min-w-[180px] flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
                      <button type="submit" disabled={pending} className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "保存中…" : "保存"}</button>
                      <button type="button" onClick={cancelEdit} disabled={pending} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 disabled:opacity-50">取消</button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-800">{category.name}</p>
                        <p className="mt-0.5 truncate text-xs text-neutral-400">/{category.slug}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => beginEdit({ kind: "category", id: category.id }, category.name)} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900">编辑</button>
                        <DeleteButton action={() => deleteCategoryByIdAction(category.id)} confirmText={`确定删除分类“${category.name}”？文章中的该分类会被清空。`} />
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl bg-white p-5 shadow-sm sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-[0.14em] text-accent">TAGS</p>
            <h2 className="mt-1 text-lg font-bold">标签管理</h2>
            <p className="mt-1 text-sm text-neutral-500">标签来自文章内容；改名或删除会批量更新所有文章。</p>
          </div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs text-neutral-500">{tags.length} 个</span>
        </div>

        {tags.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed border-neutral-200 px-4 py-8 text-center text-sm text-neutral-400">暂时没有标签，请在文章编辑页添加。</p>
        ) : (
          <ul className="mt-4 divide-y divide-neutral-100">
            {tags.map((item) => {
              const isEditing = editing?.kind === "tag" && editing.tag === item.tag;
              return (
                <li key={item.tag} className="flex min-h-16 flex-col justify-center gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                  {isEditing ? (
                    <form
                      className="flex min-w-0 flex-1 flex-wrap gap-2"
                      onSubmit={(event) => {
                        event.preventDefault();
                        saveTag(item.tag);
                      }}
                    >
                      <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} maxLength={80} className="min-w-[180px] flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
                      <button type="submit" disabled={pending} className="rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "保存中…" : "保存"}</button>
                      <button type="button" onClick={cancelEdit} disabled={pending} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-600 disabled:opacity-50">取消</button>
                    </form>
                  ) : (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-neutral-800">#{item.tag}</p>
                        <p className="mt-0.5 text-xs text-neutral-400">{item.count} 篇文章使用</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button type="button" onClick={() => beginEdit({ kind: "tag", tag: item.tag }, item.tag)} className="rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-600 transition-colors hover:border-neutral-400 hover:text-neutral-900">编辑</button>
                        <DeleteButton action={() => deleteTagAction(item.tag)} confirmText={`确定删除标签“#${item.tag}”？所有文章中的该标签都会被移除。`} />
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
