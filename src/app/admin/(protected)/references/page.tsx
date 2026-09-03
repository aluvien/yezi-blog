import { articleReferenceCoverSrc, formatArticleReferenceDate } from "@/lib/article-reference";
import { listCategories, listReferenceLibrary, listReferenceLibraryCategories, listReferenceLibraryTags, listReferenceRelationCountsBulk } from "@/lib/db";
import { formatDate } from "@/lib/format";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import AdminReferenceSummary from "@/components/admin/AdminReferenceSummary";
import { ArticleReferenceArchiveActions } from "@/components/admin/ArticleReferenceArchiveActions";
import AdminReferenceAddButton from "@/components/admin/AdminReferenceAddButton";
import { parseArchiveReport } from "@/lib/article-reference-archive";
import DeleteButton from "@/components/admin/DeleteButton";
import { deleteReferenceLibraryAction, updateReferenceLibraryMetadataAction } from "@/lib/actions/references";
import { ReferenceSelectionCheckbox, ReferenceSelectionProvider } from "@/components/admin/ReferenceSelectionControls";
import ReferenceCollectionEditor from "@/components/admin/ReferenceCollectionEditor";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";
import { parsePostTags } from "@/lib/post-tags";

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
  const relationCounts = listReferenceRelationCountsBulk(references.map((reference) => reference.id));
  const categoryOptions = [...new Set([
    ...listCategories().map((item) => item.name),
    ...listReferenceLibraryCategories().map((item) => item.category),
  ])].sort((a, b) => a.localeCompare(b, "zh-CN"));
  const tagOptions = listReferenceLibraryTags().map((item) => item.tag);

  return (
    <div className="flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader
        eyebrow="LIFE · REFERENCES"
        title={`收藏引用（${references.length}）`}
        description="独立保存站外资料的来源、封面与备注；关联本地内容可选，阅读缓存仅管理员可见。"
        actions={<AdminReferenceAddButton categoryOptions={categoryOptions} tagOptions={tagOptions} />}
      />

      {references.length === 0 ? (
        <p className="rounded-2xl bg-white py-12 text-center text-sm text-neutral-400">还没有保存文章引用</p>
      ) : (
        <ReferenceSelectionProvider ids={references.map((reference) => reference.id)}>
        <ul className="flex flex-col gap-3">
          {references.map((reference) => {
            const points = parseKeyPoints(reference.key_points);
            const publishedAt = formatArticleReferenceDate(reference.published_at);
            const report = parseArchiveReport(reference.archive_cache_report);
            const tags = parsePostTags(reference.tags);
            const imageCount = report.cachedImages + report.reusedImages;
            const qualityLabel = report.quality === "good" ? "质量良好" : report.quality === "poor" ? "建议检查" : "质量一般";
            return (
              <li key={reference.id} className="admin-reference-item admin-card admin-content-card rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <ReferenceSelectionCheckbox id={reference.id} />
                  <DeleteButton
                    action={deleteReferenceLibraryAction.bind(null, reference.id)}
                    confirmText="确定从引用资料库删除这条记录？不会修改已关联文章正文。"
                  />
                </div>
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
                    <form action={updateReferenceLibraryMetadataAction.bind(null, reference.id)} className="mt-3 grid max-w-xl gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
                      <label htmlFor={`reference-category-${reference.id}`} className="text-xs text-neutral-400">
                        分类
                        <select
                          id={`reference-category-${reference.id}`}
                          name="category"
                          defaultValue={reference.category}
                          className="mt-1 w-full rounded-lg border border-neutral-200 bg-transparent px-2.5 py-1.5 text-xs text-neutral-700 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                        >
                          <option value="">未分类</option>
                          {categoryOptions.map((category) => <option key={category} value={category}>{category}</option>)}
                        </select>
                      </label>
                      <label htmlFor={`reference-tags-${reference.id}`} className="text-xs text-neutral-400">
                        标签
                        <input
                          id={`reference-tags-${reference.id}`}
                          name="tags"
                          defaultValue={tags.join(", ")}
                          list="reference-tag-options"
                          maxLength={1000}
                          placeholder="逗号分隔"
                          className="mt-1 w-full rounded-lg border border-neutral-200 bg-transparent px-2.5 py-1.5 text-xs text-neutral-700 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                        />
                      </label>
                      <button type="submit" className="shrink-0 rounded-lg border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-500 transition-colors hover:border-accent/40 hover:text-accent">保存</button>
                    </form>
                    <ReferenceCollectionEditor
                      referenceId={reference.id}
                      initialNote={reference.note}
                      initialStatus={reference.status}
                      initialFavorite={reference.favorite === 1}
                      savedAt={reference.saved_at}
                      relationCounts={relationCounts.get(reference.id) ?? { post: 0, life_event: 0, work: 0, github_repository: 0 }}
                    />
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
        <datalist id="reference-tag-options">
          {tagOptions.map((tag) => <option key={tag} value={tag} />)}
        </datalist>
        </ReferenceSelectionProvider>
      )}
    </div>
  );
}
