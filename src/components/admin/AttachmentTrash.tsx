"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { restoreAttachmentAction } from "@/lib/actions/attachments";
import type { TrashedAttachment } from "@/lib/attachment-trash";

export default function AttachmentTrash({ files }: { files: TrashedAttachment[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(files.length / 5));
  const current = Math.min(page, pages);
  return <section className="admin-card p-5 sm:p-6" aria-labelledby="attachment-trash-title">
    <h2 id="attachment-trash-title" className="text-base font-semibold">附件回收站（{files.length}）</h2>
    <p className="mt-2 text-sm text-neutral-500">删除与批量清理的文件保留在这里，可恢复到原链接。回收站也包含在完整数据备份中。</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
    {!files.length ? <p className="mt-4 text-sm text-neutral-400">回收站为空</p> : <ul className="mt-4 divide-y divide-neutral-200">
      {files.slice((current - 1) * 5, current * 5).map(file => <li key={file.id} className="flex items-center justify-between gap-4 py-3">
        <div className="min-w-0"><p className="truncate text-sm font-medium">{file.original_name}</p><p className="mt-1 break-all text-xs text-neutral-500">{file.path}</p><p className="mt-1 text-xs text-neutral-400">{new Date(file.deletedAt).toLocaleString("zh-CN")} · {(file.size / 1024 / 1024).toFixed(2)} MB</p></div>
        <button type="button" disabled={pending} className="admin-action-link inline-flex shrink-0 items-center gap-1 text-sm disabled:opacity-50" onClick={() => startTransition(async () => {
          setError("");
          try { const result = await restoreAttachmentAction(file.id); if (!result.ok) setError(result.error); else router.refresh(); }
          catch { setError("恢复失败，请稍后重试"); }
        })}><RotateCcw size={14} />恢复</button>
      </li>)}
    </ul>}
    {pages > 1 && <div className="mt-3 flex items-center justify-end gap-4 text-sm"><button type="button" disabled={current === 1} onClick={() => setPage(current - 1)}>上一页</button><span>{current} / {pages}</span><button type="button" disabled={current === pages} onClick={() => setPage(current + 1)}>下一页</button></div>}
  </section>;
}
