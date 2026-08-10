import Link from "next/link";
import { getContentMetricsBulk, listAllPosts } from "@/lib/db";
import { parsePostTags } from "@/lib/post-tags";
import { deletePostAction } from "@/lib/actions/posts";
import { formatDate } from "@/lib/format";
import DeleteButton from "@/components/admin/DeleteButton";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default function AdminPostsPage() {
  const posts = listAllPosts();
  const metrics = getContentMetricsBulk("post", posts.map((post) => post.id));

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        eyebrow="POSTS"
        title={`文章（${posts.length}）`}
        description="管理已发布文章与草稿内容，查看文章数据并维护分类和标签。"
        actions={(
          <Link
            href="/admin/posts/new"
            className="admin-button admin-button-primary rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white active:bg-neutral-700"
          >
            + 写文章
          </Link>
        )}
      />
      {posts.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">还没有文章</p>}
      <ul className="flex flex-col gap-2">
        {posts.map((post) => {
          const tags = parsePostTags(post.tags);
          const postMetrics = metrics.get(post.id) ?? { views: 0, likes: 0 };
          return (
            <li key={post.id} className="admin-card admin-content-card rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/posts/${post.id}/edit`}
                      className="min-w-0 truncate text-base font-medium transition-colors hover:text-accent"
                      aria-label={`编辑文章：${post.title}`}
                    >
                      {post.title}
                    </Link>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${post.status === "published" ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-600"}`}>
                      {post.status === "published" ? "已发布" : "草稿"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-neutral-400">/{post.slug}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-neutral-400">
                    <span>{formatDate(post.created_at)}</span>
                    <span>·</span>
                    <span>浏览 {postMetrics.views}</span>
                    <span>·</span>
                    <span>点赞 {postMetrics.likes}</span>
                    {post.updated_at !== post.created_at && <><span>·</span><span>更新于 {formatDate(post.updated_at)}</span></>}
                  </div>
                  {(post.category.trim() || tags.length > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {post.category.trim() && <span className="font-medium text-accent">{post.category}</span>}
                      {post.category.trim() && tags.length > 0 && <span className="text-neutral-300" aria-hidden="true">·</span>}
                      {tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">#{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-2 sm:pt-0.5">
                  {post.status === "published" && (
                    <Link href={`/posts/${post.slug}`} target="_blank" className="admin-action-link admin-action-link-primary text-sm text-blue-700 hover:text-blue-900">查看</Link>
                  )}
                  <Link href={`/admin/posts/${post.id}/edit`} className="admin-action-link admin-action-link-primary text-sm text-neutral-700 hover:text-neutral-950">
                    编辑
                  </Link>
                  <DeleteButton action={deletePostAction.bind(null, post.id)} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
