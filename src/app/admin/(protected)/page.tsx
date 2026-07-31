import Link from "next/link";
import { countMoments, countPendingComments, countWorks, listAllPosts } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function AdminDashboard() {
  const pending = countPendingComments();
  const posts = listAllPosts();
  const published = posts.filter((post) => post.status === "published").length;
  const stats = [
    { label: `文章（${published} 已发布）`, count: posts.length, href: "/admin/posts" },
    { label: "想法", count: countMoments(), href: "/admin/moments" },
    { label: "作品", count: countWorks(), href: "/admin/works" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">仪表盘</h1>

      <Link
        href="/admin/comments"
        className={`flex items-center justify-between rounded-2xl p-4 ${
          pending > 0 ? "bg-amber-100 text-amber-900" : "bg-white text-neutral-600 shadow-sm"
        }`}
      >
        <span className="text-base font-medium">待审核评论</span>
        <span className={`text-2xl font-bold ${pending > 0 ? "text-amber-700" : ""}`}>{pending}</span>
      </Link>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.href} href={s.href} className="rounded-2xl bg-white p-4 text-center shadow-sm">
            <div className="text-2xl font-bold">{s.count}</div>
            <div className="mt-1 text-sm text-neutral-500">{s.label}</div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          href="/admin/posts/new"
          className="rounded-2xl bg-neutral-900 p-4 text-center text-base font-medium text-white active:bg-neutral-700"
        >
          + 写文章
        </Link>
        <Link
          href="/admin/moments/new"
          className="rounded-2xl bg-neutral-900 p-4 text-center text-base font-medium text-white active:bg-neutral-700"
        >
          + 发想法
        </Link>
        <Link
          href="/admin/works/new"
          className="rounded-2xl border border-neutral-200 bg-white p-4 text-center text-base font-medium text-neutral-800 active:bg-neutral-50 sm:col-span-2"
        >
          + 添加作品
        </Link>
      </div>
    </div>
  );
}
