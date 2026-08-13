"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReferenceLibraryAction } from "@/lib/actions/posts";
import type { ArticleReferenceSnapshot } from "@/lib/article-reference";
import { ArticleReferenceDialog } from "./ArticleReferenceDialog";

/** 引用库入口：保存站外文章本身，不要求先选择本地文章。 */
export default function AdminReferenceAddButton({ categoryOptions = [] }: { categoryOptions?: string[] }) {
  const router = useRouter();
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();

  function selectReference(selection: { marker: string; snapshot: ArticleReferenceSnapshot; category?: string } | null) {
    menuRef.current?.removeAttribute("open");
    if (!selection) return;
    setMessage("");
    setError("");
    startTransition(async () => {
      const result = await saveReferenceLibraryAction(selection.snapshot, selection.category);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessage(result.message || "引用已保存");
      router.refresh();
    });
  }

  return (
    <>
      <details ref={menuRef} className="admin-reference-add-menu relative shrink-0">
        <summary onClick={() => { setError(""); setMessage(""); }} className="list-none rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700">
          添加引用
        </summary>
        <ArticleReferenceDialog onClose={selectReference} showCategory categoryOptions={categoryOptions} />
      </details>
      {message && <span className="text-sm text-green-700">{message}</span>}
      {error && <span className="text-sm text-red-600">{error}</span>}
    </>
  );
}
