"use client";

import { createContext, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { deleteReferenceLibraryManyAction } from "@/lib/actions/references";

type ReferenceSelectionContextValue = {
  selected: Set<number>;
  toggle: (id: number) => void;
};

const ReferenceSelectionContext = createContext<ReferenceSelectionContextValue | null>(null);

type ProviderProps = {
  ids: number[];
  children: ReactNode;
};

export function ReferenceSelectionProvider({ ids, children }: ProviderProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<number>>(() => new Set());
  const [pending, startTransition] = useTransition();
  const idSet = useMemo(() => new Set(ids), [ids]);
  const visibleSelected = useMemo(() => new Set([...selected].filter((id) => idSet.has(id))), [idSet, selected]);
  const selectedCount = visibleSelected.size;
  const allSelected = ids.length > 0 && selectedCount === ids.length;

  const context = useMemo<ReferenceSelectionContextValue>(() => ({
    selected: visibleSelected,
    toggle: (id) => {
      setSelected((current) => {
        const next = new Set([...current].filter((item) => idSet.has(item)));
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
  }), [idSet, visibleSelected]);

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(ids));
  }

  function deleteSelected() {
    if (selectedCount === 0 || pending) return;
    if (!window.confirm(`确定删除选中的 ${selectedCount} 条引用？只会移除资料库记录，不会修改已关联文章。`)) return;
    startTransition(async () => {
      const result = await deleteReferenceLibraryManyAction([...visibleSelected]);
      if (!result.ok) {
        window.alert(result.error);
        return;
      }
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <ReferenceSelectionContext.Provider value={context}>
      <div className="admin-reference-bulk-toolbar" aria-label="引用批量操作">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-neutral-600">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={pending || ids.length === 0} className="h-4 w-4 accent-accent" />
          全选
        </label>
        <span className="text-xs text-neutral-400">已选 {selectedCount} 条</span>
        {selectedCount > 0 && (
          <button type="button" onClick={() => setSelected(new Set())} disabled={pending} className="text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-50">
            清除选择
          </button>
        )}
        <button type="button" onClick={deleteSelected} disabled={pending || selectedCount === 0} className="admin-action-link admin-action-link-danger text-sm text-red-600 disabled:cursor-not-allowed disabled:opacity-40">
          {pending ? "删除中…" : "删除选中"}
        </button>
      </div>
      {children}
    </ReferenceSelectionContext.Provider>
  );
}

export function ReferenceSelectionCheckbox({ id }: { id: number }) {
  const context = useContext(ReferenceSelectionContext);
  if (!context) throw new Error("ReferenceSelectionCheckbox must be rendered inside ReferenceSelectionProvider");
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-neutral-500">
      <input type="checkbox" checked={context.selected.has(id)} onChange={() => context.toggle(id)} className="h-4 w-4 accent-accent" />
      选择
    </label>
  );
}
