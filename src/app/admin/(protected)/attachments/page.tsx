import AttachmentTrash from "@/components/admin/AttachmentTrash";
import { listTrashedAttachments } from "@/lib/attachment-trash";
import type { AttachmentReference } from "@/lib/db";
import Link from "next/link";
import { listAttachments } from "@/lib/db";
import { compressAttachmentAction, compressUntrackedAttachmentAction, deleteAttachmentAction, deleteUntrackedAttachmentAction } from "@/lib/actions/attachments";
import DeleteButton from "@/components/admin/DeleteButton";
import ClearUnusedAttachmentsButton from "@/components/admin/ClearUnusedAttachmentsButton";
import CompressAttachmentButton from "@/components/admin/CompressAttachmentButton";
import { formatDate } from "@/lib/format";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function referenceLink(ref: AttachmentReference): string {
  switch (ref.type) {
    case "post": return `/admin/posts/${ref.id}/edit`;
    case "moment": return `/admin/moments/${ref.id}/edit`;
    case "life_event": return `/admin/life/milestones/${ref.id}/edit`;
    case "work": return `/admin/works/${ref.id}/edit`;
    case "github_repository": return "/admin/life/github";
    case "reference": return "/admin/references";
    default: return ref.label === "关于页内容" ? "/admin/pages/about" : "/admin/settings";
  }
}
const referenceLabels: Record<AttachmentReference["type"], string> = { post: "文章", moment: "絮语", setting: "站点设置", life_event: "小记", work: "作品", github_repository: "仓库", reference: "引用" };

export default function AdminAttachmentsPage() {
  const attachments = listAttachments();
  const unusedCount = attachments.filter((attachment) => !attachment.referenced).length;

  return (
    <div className="admin-page flex flex-col gap-4">
      <AdminPageHeader
        eyebrow="ATTACHMENTS"
        title={`附件管理（${attachments.length}）`}
        description="同时扫描上传目录；目录中未入库、未被使用的文件也可以安全清理。"
        actions={<ClearUnusedAttachmentsButton count={unusedCount} />}
      />

      {attachments.length === 0 ? (
        <p className="admin-card admin-empty-state">还没有上传附件</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {attachments.map((attachment) => (
            <li
              key={attachment.path}
              className="admin-card admin-content-card grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-3 rounded-2xl bg-white p-4 shadow-sm sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] sm:items-center sm:p-5"
            >
              {attachment.mime_type.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={attachment.path} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 object-cover" />
              ) : (
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs font-medium uppercase text-neutral-500">
                  {attachment.mime_type.split("/").pop()?.slice(0, 5) || "file"}
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-800">{attachment.original_name}</p>
                <p className="mt-1 flex items-center gap-2 whitespace-nowrap text-xs text-neutral-400">
                  <span className="shrink-0">{formatBytes(attachment.size)}</span>
                  <span aria-hidden="true">·</span>
                  <span className="shrink-0">{formatDate(attachment.created_at)}</span>
                </p>
                <div className="mt-2 flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-xs">
                  <span className={`shrink-0 rounded-full px-2 py-0.5 ${attachment.referenced ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-800"}`}>
                    {attachment.tracked ? (attachment.referenced ? "已引用" : "未引用") : "目录未入库"}
                  </span>
                  {attachment.references.map((ref, i) => (
                    <Link
                      key={`${ref.type}-${ref.id}-${i}`}
                      href={referenceLink(ref)}
                      className="admin-link min-w-0 truncate text-blue-700 no-underline hover:text-blue-900"
                    >
                      {`${referenceLabels[ref.type]}：${ref.label}`}
                    </Link>
                  ))}
                </div>
              </div>
              <div className="col-start-2 flex shrink-0 items-center gap-3 sm:col-start-3 sm:row-start-1 sm:justify-self-end">
                {attachment.tracked && <Link href={`/admin/attachments/${attachment.id}`} className="admin-action-link admin-action-link-primary text-sm text-blue-700 no-underline">详情</Link>}
                <a href={attachment.path} target="_blank" rel="noopener noreferrer" className="admin-action-link admin-action-link-primary text-sm text-blue-700 no-underline">打开</a>
                {["image/jpeg", "image/png", "image/webp"].includes(attachment.mime_type) && (
                  <CompressAttachmentButton
                    action={attachment.tracked ? compressAttachmentAction.bind(null, attachment.id) : compressUntrackedAttachmentAction.bind(null, attachment.path)}
                  />
                )}
                {!attachment.referenced && (
                  <DeleteButton
                    action={attachment.tracked ? deleteAttachmentAction.bind(null, attachment.id) : deleteUntrackedAttachmentAction.bind(null, attachment.path)}
                    confirmText={attachment.tracked ? "将这个未引用附件移入回收站？之后可以恢复。" : "将这个目录附件移入回收站？之后可以恢复。"}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <AttachmentTrash files={listTrashedAttachments()} />
    </div>
  );
}
