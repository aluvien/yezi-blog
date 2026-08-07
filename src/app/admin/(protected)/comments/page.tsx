import Link from "next/link";
import { listCommentsForAdmin } from "@/lib/db";
import { formatDate } from "@/lib/format";
import CommentActions from "@/components/admin/CommentActions";

export const dynamic = "force-dynamic";

type Filter = "all" | "pending" | "approved";

export default async function AdminCommentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: rawStatus } = await searchParams;
  const status: Filter = rawStatus === "pending" || rawStatus === "approved" ? rawStatus : "all";
  const allComments = listCommentsForAdmin();
  const comments = status === "all" ? allComments : allComments.filter((comment) => comment.status === status);
  const pendingCount = allComments.filter((comment) => comment.status === "pending").length;
  const approvedCount = allComments.length - pendingCount;
  const tabs: Array<{ value: Filter; label: string; count: number }> = [
    { value: "all", label: "全部", count: allComments.length },
    { value: "pending", label: "待审核", count: pendingCount },
    { value: "approved", label: "已公开", count: approvedCount },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-bold">评论管理</h1>
        <p className="mt-1 text-sm text-neutral-500">审核访客评论、公开或撤回，并以作者身份回复。</p>
      </div>
      <nav className="flex gap-2 overflow-x-auto" aria-label="评论筛选">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={tab.value === "all" ? "/admin/comments" : `/admin/comments?status=${tab.value}`}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm ${status === tab.value ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 shadow-sm"}`}
          >
            {tab.label} {tab.count}
          </Link>
        ))}
      </nav>
      {comments.length === 0 && <p className="rounded-2xl bg-white py-12 text-center text-sm text-neutral-400">当前筛选下暂无评论</p>}
      <ul className="flex flex-col gap-3">
        {comments.map((comment) => {
          const targetHref = comment.target_type === "post"
            ? comment.target_slug ? `/posts/${comment.target_slug}#comments` : null
            : `/moments#moment-${comment.target_id}`;
          return (
            <li key={comment.id} className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 max-w-full text-sm font-medium">
                  {comment.nickname}
                  <span className="ml-2 break-all text-xs font-normal text-neutral-400">{comment.email || "未留邮箱"}</span>
                  <span className={`ml-2 inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs ${comment.status === "pending" ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                    {comment.status === "pending" ? "待审核" : "已公开"}
                  </span>
                  {comment.website && (
                    <a href={comment.website} target="_blank" rel="noopener noreferrer" className="ml-2 break-all text-xs font-normal text-blue-700 underline">网站</a>
                  )}
                </span>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-base leading-7">{comment.content}</p>
              {comment.admin_reply && (
                <div className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-sm leading-6 text-green-900">
                  <span className="font-medium">作者回复：</span>{comment.admin_reply}
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-500">
                <span>{comment.target_type === "post" ? "文章" : "想法"}：</span>
                {targetHref ? <Link href={targetHref} target="_blank" className="max-w-full truncate text-blue-700 hover:text-blue-900">{comment.target_label ?? "查看内容"}</Link> : <span>{comment.target_label ?? "目标已删除"}</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
                <span>IP {comment.ip_address || "历史记录无真实 IP"}</span><span>·</span><span>{formatDate(comment.created_at)}</span>
              </div>
              <CommentActions id={comment.id} status={comment.status} initialReply={comment.admin_reply} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
