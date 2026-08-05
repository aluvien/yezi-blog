import Link from "next/link";
import { listAttachments } from "@/lib/db";
import { deleteAttachmentAction } from "@/lib/actions/attachments";
import DeleteButton from "@/components/admin/DeleteButton";
import ClearUnusedAttachmentsButton from "@/components/admin/ClearUnusedAttachmentsButton";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function AdminAttachmentsPage() {
  const attachments = listAttachments();
  const unusedCount = attachments.filter((attachment) => !attachment.referenced).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-bold">附件管理（{attachments.length}）</h1>
          <p className="mt-1 text-sm text-neutral-500">查看文章附件的引用状态，未引用文件可以安全清理。</p>
        </div>
        <ClearUnusedAttachmentsButton count={unusedCount} />
      </div>

      {attachments.length === 0 ? (
        <p className="rounded-2xl bg-white py-12 text-center text-sm text-neutral-400">还没有上传附件</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              {attachment.mime_type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachment.path} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 object-cover" />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-medium uppercase text-neutral-500">
                  {attachment.mime_type.split("/").pop()?.slice(0, 5) || "file"}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-800">{attachment.original_name}</p>
                <p className="mt-1 text-xs text-neutral-400">{formatBytes(attachment.size)} · {formatDate(attachment.created_at)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${attachment.referenced ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>
                    {attachment.referenced ? "已引用" : "未引用"}
                  </span>
                  {attachment.references.map((ref, i) => (
                    <Link
                      key={`${ref.type}-${ref.id}-${i}`}
                      href={ref.type === "post" ? `/admin/posts/${ref.id}/edit` : `/admin/moments/${ref.id}/edit`}
                      className="max-w-full truncate text-blue-700 underline hover:text-blue-900"
                    >
                      {ref.type === "post" ? ref.label : `想法：${ref.label}`}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="ml-[4.25rem] flex shrink-0 flex-wrap gap-x-4 gap-y-2 sm:ml-auto">
                <Link href={`/admin/attachments/${attachment.id}`} className="text-sm text-blue-700 underline">详情</Link>
                <a href={attachment.path} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 underline">打开</a>
                {!attachment.referenced && <DeleteButton action={deleteAttachmentAction.bind(null, attachment.id)} confirmText="确定删除这个未引用附件？此操作不可恢复。" />}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
