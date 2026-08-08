import type { Metadata } from "next";
import { countApprovedCommentsBulk, getContentMetricsBulk, getSiteSettings, listMoments, listPosts } from "@/lib/db";
import { getSiteAuthor } from "@/lib/site";
import { getAuthorAvatar } from "@/lib/author";
import { parsePostTags } from "@/lib/post-tags";
import { PostEntry } from "@/components/site/PostEntry";
import { MomentEntry } from "@/components/site/MomentEntry";
import { PageHeader } from "@/components/site/PageHeader";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "搜索",
  description: "搜索文章与想法。",
};

function includesQuery(value: string, query: string): boolean {
  return value.toLocaleLowerCase().includes(query.toLocaleLowerCase());
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = ((await searchParams).q ?? "").trim();
  if (!query) {
    return (
      <div className="mx-auto max-w-[760px] py-8 md:py-12">
        <PageHeader eyebrow="站内搜索" title="搜索" description="输入关键词，查找文章与想法。" />
        <p className="py-16 text-center text-[14px] text-muted">请从页头搜索按钮输入关键词。</p>
      </div>
    );
  }
  const posts = listPosts().filter((post) => {
    return includesQuery(post.title, query) || includesQuery(post.content, query) || includesQuery(post.category, query) || parsePostTags(post.tags).some((tag) => includesQuery(tag, query));
  });
  const moments = listMoments().filter((moment) => !query || includesQuery(moment.content, query));
  const siteSettings = getSiteSettings();
  const authorName = getSiteAuthor(siteSettings);
  const isAuthorized = !!(await getSession());
  const postCommentCounts = countApprovedCommentsBulk("post", posts.map((post) => post.id));
  const momentCommentCounts = countApprovedCommentsBulk("moment", moments.map((moment) => moment.id));
  const momentMetrics = getContentMetricsBulk("moment", moments.map((moment) => moment.id));
  const emptyMetrics = { views: 0, likes: 0 };
  const results = [
    ...posts.map((post) => ({ type: "post" as const, createdAt: post.created_at, post })),
    ...moments.map((moment) => ({ type: "moment" as const, createdAt: moment.created_at, moment })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="mx-auto max-w-[760px] py-8 md:py-12">
      <PageHeader
        eyebrow="站内搜索"
        title={`搜索：${query}`}
        description={`找到 ${posts.length + moments.length} 条相关记录。`}
      />

      {results.length === 0 ? (
        <p className="py-16 text-center text-[14px] text-muted">没有找到相关内容。</p>
      ) : (
        <div>
          {results.map((result) => result.type === "post" ? (
            <div key={`post-${result.post.id}`} className="py-6 md:py-7">
              <PostEntry post={result.post} commentCount={postCommentCounts.get(result.post.id) ?? 0} canEdit={isAuthorized} />
            </div>
          ) : (
            <div key={`moment-${result.moment.id}`} className="py-6 md:py-7">
              <MomentEntry
                moment={result.moment}
                commentCount={momentCommentCounts.get(result.moment.id) ?? 0}
                metrics={momentMetrics.get(result.moment.id) ?? emptyMetrics}
                authorName={authorName}
                authorAvatar={getAuthorAvatar(siteSettings) || undefined}
                authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"}
                canEdit={isAuthorized}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
