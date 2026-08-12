import { articleReferenceCoverSrc, formatArticleReferenceDate } from "@/lib/article-reference";
import { listReferenceLibrary } from "@/lib/db";
import { formatDate } from "@/lib/format";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminReferenceSummary from "@/components/admin/AdminReferenceSummary";
import { ArticleReferenceArchiveActions } from "@/components/admin/ArticleReferenceArchiveActions";
import AdminReferenceAddButton from "@/components/admin/AdminReferenceAddButton";
import { parseArchiveReport } from "@/lib/article-reference-archive";

export const dynamic = "force-dynamic";

function parseKeyPoints(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 6) : [];
  } catch {
    return [];
  }
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.length > 32 ? `${url.pathname.slice(0, 32)}…` : url.pathname;
    return `${url.hostname}${path === "/" ? "" : path}`;
  } catch {
    return value.length > 48 ? `${value.slice(0, 48)}…` : value;
  }
}

export default function AdminReferencesPage() {
  const references = listReferenceLibrary();

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        eyebrow="ARTICLE REFERENCES"
        title={`引用管理（${references.length}）`}
        description="独立保存站外文章的来源、封面和摘要；关联本地文章是可选的，阅读缓存仅管理员可见。"
        actions={<AdminReferenceAddButton />}
      />

      {references.length === 0 ? (
        <p className="rounded-2xl bg-white py-12 text-center text-sm text-neutral-400">还没有保存文章引用</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {references.map((reference) => {
            const points = parseKeyPoints(reference.key_points);
            const publishedAt = formatArticleReferenceDate(reference.published_at);
            const report = parseArchiveReport(reference.archive_cache_report);
            const imageCount = report.cachedImages + report.reusedImages;
            const qualityLabel = report.quality === "good" ? "质量良好" : report.quality === "poor" ? "建议检查" : "质量一般";
            return (
              <li key={reference.id} className="admin-reference-item admin-card admin-content-card rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                <div className="admin-reference-main">
                  {reference.cover ? (
                    // 引用封面统一走服务端代理，避免公众号图片防盗链。
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={articleReferenceCoverSrc(reference.cover, reference.url)} alt="" className="admin-reference-cover-image" />
                  ) : (
                    <div className="admin-reference-cover-image flex items-center justify-center bg-accent/10 text-2xl font-semibold text-accent">引</div>
                  )}
                  <div className="admin-reference-copy">
                    <div className="admin-reference-source-line">
                      <p className="min-w-0 truncate text-xs text-accent">
                        <span className="mr-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px]">#{reference.id}</span>
                        {reference.source_name || "网页文章"}
                        {reference.author ? ` · ${reference.author}` : ""}
                        {publishedAt ? ` · ${publishedAt}` : ""}
                      </p>
                      <ArticleReferenceArchiveActions referenceId={reference.id} url={reference.url} cached={Boolean(reference.archive_captured_at)} variant="source" />
                    </div>
                    <a href={reference.url} target="_blank" rel="noopener noreferrer" className="admin-reference-title no-underline hover:text-accent">
                      {reference.title}
                    </a>
                  </div>
                </div>

                <div className="admin-reference-details">
                <p className="admin-reference-detail-line">
                  <span className="shrink-0">引用网址：</span>
                  <a href={reference.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-neutral-700 no-underline hover:text-accent" title={reference.url}>{shortUrl(reference.url)}</a>
                </p>
                <div className="admin-reference-detail-line">
                  <span className="shrink-0">关联文章：</span>
                  {reference.linked_post_count > 0 ? (
                    <span className="min-w-0 truncate text-neutral-700" title={reference.linked_post_titles || undefined}>{reference.linked_post_titles}</span>
                  ) : (
                    <span className="text-neutral-400">暂未关联文章</span>
                  )}
                </div>
                </div>

                <div className="admin-reference-status-row">
                  <span className={`rounded-full px-2 py-0.5 ${reference.summary || points.length > 0 ? "bg-accent/10 text-accent" : "bg-neutral-100 text-neutral-400"}`}>
                    {reference.summary || points.length > 0 ? "AI 摘要已生成" : "未生成 AI 摘要"}
                  </span>
                  <span className="text-neutral-400">最近同步：{formatDate(reference.updated_at)}</span>
                  {reference.archive_captured_at && <span className="text-neutral-400">阅读缓存：{formatDate(reference.archive_updated_at || reference.archive_captured_at)}</span>}
                  {reference.archive_captured_at && report.keptBlocks > 0 && (
                    <span className={`admin-reference-cache-report is-${report.quality}`} title={`保留 ${report.keptBlocks} 块；规则清理 ${report.ruleRemovedBlocks} 块；AI 清理 ${report.aiRemovedBlocks} 块；跳过图片 ${report.skippedImages} 张`}>
                      <span className="admin-reference-report-mobile">{imageCount} 张图片 · {qualityLabel}</span>
                      <span className="admin-reference-report-desktop">正文 {report.textCharacters.toLocaleString()} 字 · 图片 {imageCount} 张 · 清理 {report.removedBlocks} 块 · {qualityLabel}</span>
                    </span>
                  )}
                  <div className="admin-reference-reader-actions">
                    {(reference.summary || points.length > 0) && (
                      <AdminReferenceSummary summary={reference.summary} points={points} />
                    )}
                    <ArticleReferenceArchiveActions
                      referenceId={reference.id}
                      url={reference.url}
                      cached={Boolean(reference.archive_captured_at)}
                    />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
