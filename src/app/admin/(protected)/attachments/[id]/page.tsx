import Link from "next/link";
import { notFound } from "next/navigation";
import { getAttachment } from "@/lib/db";
import { AttachmentCrop } from "@/components/admin/AttachmentCrop";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AttachmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const attachment = getAttachment(Number(id));
  if (!attachment) notFound();
  const isImage = attachment.mime_type.startsWith("image/");

  return (
    <div className="flex flex-col gap-5">
      <div>
        <Link href="/admin/attachments" className="text-sm text-neutral-500 hover:text-neutral-900">← 返回附件列表</Link>
        <h1 className="mt-2 text-xl font-bold">附件详情</h1>
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={attachment.path} alt={attachment.original_name} className="max-h-[400px] rounded-lg object-contain" />
        ) : (
          <div className="rounded-lg bg-neutral-100 p-8 text-center text-sm text-neutral-400">非图片文件</div>
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
          <div><dt className="text-neutral-400">文件名</dt><dd className="truncate text-neutral-800">{attachment.original_name}</dd></div>
          <div><dt className="text-neutral-400">类型</dt><dd className="text-neutral-800">{attachment.mime_type}</dd></div>
          <div><dt className="text-neutral-400">大小</dt><dd className="text-neutral-800">{formatBytes(attachment.size)}</dd></div>
          <div><dt className="text-neutral-400">上传时间</dt><dd className="text-neutral-800">{formatDate(attachment.created_at)}</dd></div>
          <div className="col-span-2"><dt className="text-neutral-400">路径</dt><dd className="truncate text-neutral-800">{attachment.path}</dd></div>
          {attachment.post_id && (
            <div><dt className="text-neutral-400">关联文章</dt><dd><Link href={`/admin/posts/${attachment.post_id}/edit`} className="text-blue-700 no-underline">查看</Link></dd></div>
          )}
        </dl>
        <div className="mt-4">
          <a href={attachment.path} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 no-underline">打开原文件</a>
        </div>
      </div>

      {isImage && (
        <div className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-800">重新裁切</h2>
          <p className="mt-1 text-xs text-neutral-400">拖拽选区后点击按钮,裁切结果另存为新附件(保留原图)。</p>
          <div className="mt-4">
            <AttachmentCrop attachmentId={attachment.id} src={attachment.path} />
          </div>
        </div>
      )}
    </div>
  );
}
