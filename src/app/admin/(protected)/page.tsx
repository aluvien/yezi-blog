import Link from "next/link";
import {
  countAttachments,
  countMoments,
  countPendingComments,
  countPosts,
  countWorks,
  getOverallMetrics,
  listCategories,
  listCommentsForAdmin,
  listRecentPosts,
  listRecentTags,
} from "@/lib/db";
import { formatDateOnly } from "@/lib/format";

export const dynamic = "force-dynamic";

export default function AdminDashboard() {
  const pending = countPendingComments();
  const recentPosts = listRecentPosts(5);
  const categories = listCategories();
  const metrics = getOverallMetrics();
  const recentComments = listCommentsForAdmin(5);

  const recentCategories = [...categories]
    .sort((a, b) => b.created_at.localeCompare(a.created_at, "zh-CN"))
    .slice(0, 5);

  const recentTags = listRecentTags(5);

  const row1 = [
    { label: "文章", count: countPosts(), href: "/admin/posts" },
    { label: "想法", count: countMoments(), href: "/admin/moments" },
    { label: "作品", count: countWorks(), href: "/admin/works" },
    { label: pending > 0 ? `评论 · 待审 ${pending}` : "评论", count: pending, href: "/admin/comments" },
  ];
  const row2 = [
    { label: "阅读", count: metrics.views, href: "/admin" },
    { label: "点赞", count: metrics.likes, href: "/admin" },
    { label: "附件", count: countAttachments(), href: "/admin/attachments" },
  ];

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-xl font-bold">仪表盘</h1>

      {/* 第一排:文章 / 想法 / 作品 / 评论 */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {row1.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="min-w-0 rounded-2xl bg-white p-3 text-center shadow-sm sm:p-4"
          >
            <div className="text-xl font-bold sm:text-2xl">{s.count}</div>
            <div className="mt-1 truncate whitespace-nowrap text-[11px] text-neutral-500 sm:text-sm">
              {s.label}
            </div>
          </Link>
        ))}
      </div>

      {/* 第二排:阅读 / 点赞 / 附件 / 分类管理(不显示数量) */}
      <div className="grid grid-cols-4 gap-2 sm:gap-3">
        {row2.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="min-w-0 rounded-2xl bg-white p-3 text-center shadow-sm sm:p-4"
          >
            <div className="text-xl font-bold sm:text-2xl">{s.count}</div>
            <div className="mt-1 truncate whitespace-nowrap text-[11px] text-neutral-500 sm:text-sm">
              {s.label}
            </div>
          </Link>
        ))}
        <Link
          href="/admin/categories"
          className="min-w-0 rounded-2xl bg-white p-3 text-center shadow-sm sm:p-4"
        >
          <div className="truncate whitespace-nowrap text-sm font-medium text-neutral-700 sm:text-base">分类管理</div>
          <div className="mt-1 truncate whitespace-nowrap text-[11px] text-neutral-500 sm:text-sm">维护索引</div>
        </Link>
      </div>

      {/* 第三排:标签+分类(上下堆叠) / 最新文章 / 最新评论 */}
      <div className="grid gap-3 md:grid-cols-3">
        <section className="flex flex-col rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-800">最新分类</h2>
          {recentCategories.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {recentCategories.map((c) => (
                <Link key={c.id} href="/admin/categories" className="rounded-full bg-neutral-100 px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-200">{c.name}</Link>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-neutral-400">还没有分类</p>}

          <h2 className="mt-5 border-t border-neutral-100 pt-4 text-sm font-semibold text-neutral-800">最新标签</h2>
          {recentTags.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {recentTags.map((tag) => (
                <Link key={tag} href="/admin/categories" className="rounded-full bg-neutral-100 px-3 py-1.5 text-sm text-neutral-700 transition-colors hover:bg-neutral-200">#{tag}</Link>
              ))}
            </div>
          ) : <p className="mt-3 text-sm text-neutral-400">还没有标签</p>}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-800">最新文章</h2>
          {recentPosts.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              {recentPosts.map((post) => (
                <li key={post.id} className="border-b border-neutral-100 pb-2 last:border-0 last:pb-0">
                  <Link href={`/admin/posts/${post.id}/edit`} className="block">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-neutral-700">{post.title}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] ${post.status === "published" ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
                        {post.status === "published" ? "已发布" : "草稿"}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-neutral-400">{formatDateOnly(post.created_at)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-neutral-400">还没有文章</p>}
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-800">最新评论</h2>
          {recentComments.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3 text-sm">
              {recentComments.map((c) => {
                return (
                  <li key={c.id} className="border-b border-neutral-100 pb-2 last:border-0 last:pb-0">
                    <Link href="/admin/comments" className="block">
                      <div className="text-xs text-neutral-400">{c.nickname} · {formatDateOnly(c.created_at)}{c.status === "pending" ? " · 待审" : ""}</div>
                      <p className="mt-0.5 line-clamp-2 text-neutral-700">{c.content}</p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <p className="mt-3 text-sm text-neutral-400">还没有评论</p>}
        </section>
      </div>
    </div>
  );
}
