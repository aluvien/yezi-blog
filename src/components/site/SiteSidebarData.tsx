import Link from "next/link";
import { countMoments, countPublishedPosts, countWorks, listLatestApprovedComments } from "@/lib/db";
import { getCachedCategories, getCachedPublishedTags } from "@/lib/server-data";
import { formatDateOnly } from "@/lib/format";
import { parseSocialLinks } from "@/lib/site";

type CardIconName = "content" | "link" | "category" | "tag" | "interaction";

function CardIcon({ name }: { name: CardIconName }) {
  const common = { className: "h-3 w-3 text-muted", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, viewBox: "0 0 24 24", "aria-hidden": true };
  switch (name) {
    case "content":
      return <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18" /></svg>;
    case "link":
      return <svg {...common}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>;
    case "category":
      return <svg {...common}><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
    case "tag":
      return <svg {...common}><path d="M20 12 12 4H4v8l8 8z" /><circle cx="8" cy="8" r="1.5" /></svg>;
    case "interaction":
      return <svg {...common}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>;
  }
}

function Label({ icon, children }: { icon: CardIconName; children: React.ReactNode }) {
  return (
    <p className="site-sidebar-label">
      <span className="inline-flex items-center gap-2">
        <CardIcon name={icon} />
        {children}
      </span>
    </p>
  );
}

/** 桌面端侧栏的动态信息：只展示本站真实数据。顺序：内容 -> 链接 -> 分类 -> 标签 -> 最新互动。 */
export function SiteSidebarData({ siteSettings }: { siteSettings: Record<string, string> }) {
  const postCount = countPublishedPosts();
  const momentCount = countMoments();
  const workCount = countWorks();
  const categories = getCachedCategories();
  const latestInteractions = listLatestApprovedComments(8);
  const tags = getCachedPublishedTags(12);
  const socialLinks = parseSocialLinks(siteSettings.social_links, 8);

  return (
    <>
      <div className="site-sidebar-card">
        <Label icon="content">内容</Label>
        <div className="site-sidebar-stat-grid mt-3">
          <Link href="/posts" className="site-sidebar-stat"><strong>{postCount}</strong><span>文章</span></Link>
          <Link href="/moments" className="site-sidebar-stat"><strong>{momentCount}</strong><span>想法</span></Link>
          <Link href="/works" className="site-sidebar-stat"><strong>{workCount}</strong><span>作品</span></Link>
        </div>
      </div>

      {socialLinks.length > 0 && (
        <div className="site-sidebar-card">
          <Label icon="link">链接</Label>
          <div className="mt-3 flex flex-col gap-1.5 text-[12px]">
            {socialLinks.map((item) => (
              <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer" className="text-wechat-blue transition-colors hover:text-accent">{item.label}</a>
            ))}
          </div>
        </div>
      )}

      {categories.length > 0 && (
        <div className="site-sidebar-card">
          <Label icon="category">分类</Label>
          <div className="site-sidebar-tags mt-3">
            {categories.slice(0, 12).map((category) => <Link key={category.id} href={`/categories/${encodeURIComponent(category.name)}`} className="site-sidebar-tag">{category.name}</Link>)}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div className="site-sidebar-card">
          <Label icon="tag">标签</Label>
          <div className="site-sidebar-tags mt-3">
            {tags.map(({ tag, count }) => (
              <Link key={tag} href={`/tags/${encodeURIComponent(tag)}`} className="site-sidebar-tag">#{tag}<sup>{count}</sup></Link>
            ))}
          </div>
        </div>
      )}

      {latestInteractions.length > 0 && (
        <div className="site-sidebar-card">
          <Label icon="interaction">最新互动</Label>
          <div className="site-sidebar-interactions mt-3">
            {latestInteractions.map((comment) => {
              const href = comment.target_type === "post" && comment.target_slug
                ? `/posts/${comment.target_slug}#comments`
                : `/moments#moment-${comment.target_id}`;
              return (
                <Link key={comment.id} href={href} className="site-sidebar-interaction">
                  <span>{comment.nickname} · {formatDateOnly(comment.created_at)}</span>
                  <p>{comment.content}</p>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}
