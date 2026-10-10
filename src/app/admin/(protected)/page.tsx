import Link from "next/link";
import { countAttachments, countMoments, countPendingComments, countPosts, getOverallMetrics, listCommentsForAdmin, listRecentPosts } from "@/lib/db";
import { getSiteUrl } from "@/lib/site-config";
import { getQQMusicHealthAlertState } from "@/lib/qq-music-health";
import { formatDateOnly } from "@/lib/format";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default function AdminDashboard() {
  const pending = countPendingComments();
  const recentPosts = listRecentPosts(5);
  const comments = listCommentsForAdmin(5);
  const metrics = getOverallMetrics();
  const music = getQQMusicHealthAlertState();
  const labels = { healthy: "上次检测正常", missing_session: "未登录", expired: "登录已失效", unavailable: "服务不可用", unverified: "尚未确认" };
  const stats = [
    { label: "文章", count: countPosts(), href: "/admin/posts", hint: "管理文章与草稿" },
    { label: "絮语", count: countMoments(), href: "/admin/moments", hint: "记录日常的点滴" },
    { label: "待审评论", count: pending, href: "/admin/comments", hint: pending ? "有新的互动待处理" : "暂无待处理评论" },
    { label: "附件", count: countAttachments(), href: "/admin/attachments", hint: "管理图片与文件" },
  ];
  return <div className="admin-page flex flex-col gap-5">
    <AdminPageHeader eyebrow="OVERVIEW" title="后台概览" description="管理内容、关注互动，查看网站的最新情况。" actions={<><Link href="/admin/moments/new" className="admin-button px-4">写絮语</Link><Link href="/admin/posts/new" className="admin-button admin-button-primary px-4">写文章</Link></>} />
    {pending > 0 && <div className="admin-pending-banner"><span>有 <strong>{pending}</strong> 条新评论等待审核</span><Link href="/admin/comments">去处理 →</Link></div>}
    <div className="admin-dashboard-stats">{stats.map(stat => <Link href={stat.href} className="admin-card" key={stat.label}><span>{stat.label}</span><strong>{stat.count}</strong><span>{stat.hint}</span></Link>)}</div>
    <div className="admin-dashboard-grid">
      <div className="admin-dashboard-column">
        <section className="admin-card admin-dashboard-section">
          <div className="admin-section-heading"><h2>最新文章</h2><Link href="/admin/posts">全部文章 →</Link></div>
          {recentPosts.length ? <ul className="admin-recent-list">{recentPosts.map(post => <li key={post.id}><Link href={`/admin/posts/${post.id}/edit`}><div className="admin-recent-title"><span>{post.title}</span><span className={`admin-status-tag ${post.status === "published" ? "is-good" : ""}`}>{post.status === "published" ? "已发布" : "草稿"}</span></div><small>{formatDateOnly(post.created_at)}</small></Link></li>)}</ul> : <p className="py-8 text-sm text-neutral-500">还没有文章，从写下第一篇开始。</p>}
        </section>
        <section className="admin-card admin-dashboard-section">
          <div className="admin-section-heading"><h2>最新评论</h2><Link href="/admin/comments">管理评论 →</Link></div>
          {comments.length ? <ul className="admin-recent-list">{comments.map(comment => <li key={comment.id}><Link href="/admin/comments"><div className="admin-recent-title"><span>{comment.nickname}</span>{comment.status === "pending" && <span className="admin-status-tag">待审核</span>}</div><p className="mt-2 line-clamp-2 text-sm text-neutral-600">{comment.content}</p><small>{formatDateOnly(comment.created_at)}</small></Link></li>)}</ul> : <p className="py-8 text-sm text-neutral-500">暂无评论，新的互动会显示在这里。</p>}
        </section>
      </div>
      <div className="admin-dashboard-column">
        <section className="admin-card admin-dashboard-section"><div className="admin-section-heading"><h2>网站状态</h2><Link href="/admin/settings">设置 →</Link></div>
          <div className="admin-site-fact"><span>当前网站</span><strong>{new URL(getSiteUrl()).host}</strong></div>
          <Link className="admin-site-fact" href="/admin/settings/music"><span>QQ 音乐</span><strong>{music.lastStatus ? labels[music.lastStatus] : "暂无检测记录"}</strong>{music.lastCheckedAt && <span>上次检测：{formatDateOnly(music.lastCheckedAt)}</span>}</Link>
          <div className="admin-site-fact"><span>累计互动</span><strong>{metrics.views} 次阅读 · {metrics.likes} 次点赞</strong></div>
          <Link className="admin-site-fact" href="/admin/settings/backups"><span>数据保护</span><strong>查看备份与恢复 →</strong></Link>
        </section>
        <section className="admin-card admin-dashboard-section"><div className="admin-section-heading"><h2>快捷入口</h2></div><div className="admin-quick-links"><Link href="/admin/attachments">附件管理</Link><Link href="/admin/settings/backups">备份恢复</Link><Link href="/admin/settings/music">音乐设置</Link><Link href="/admin/settings/appearance">外观主题</Link><Link href="/admin/categories">分类与标签</Link><Link href="/admin/settings">站点设置</Link></div></section>
      </div>
    </div>
  </div>;
}
