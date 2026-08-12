import Link from "next/link";
import { notFound } from "next/navigation";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { formatArticleReferenceDate } from "@/lib/article-reference";
import { parseArchiveReport, referenceReaderHtmlToMarkdown } from "@/lib/article-reference-archive";
import { getArticleReferenceArchive, getReferenceLibraryItem } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";

export const dynamic = "force-dynamic";

export default async function ArticleReferenceReaderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const reference = getReferenceLibraryItem(Number(id));
  if (!reference) notFound();
  const archive = getArticleReferenceArchive(reference.canonical_url);
  const report = parseArchiveReport(archive?.cache_report);
  let archivePoints: string[] = [];
  try {
    const parsed = archive ? JSON.parse(archive.key_points) as unknown : [];
    if (Array.isArray(parsed)) archivePoints = parsed.map((point) => String(point ?? "").trim()).filter(Boolean).slice(0, 6);
  } catch {
    // 旧归档没有要点时保持阅读页正常。
  }

  return (
    <div className="article-reference-reader-page flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Link href="/admin/references" className="text-sm text-neutral-500 no-underline hover:text-neutral-900">← 返回引用管理</Link>
        <AdminPageHeader
          eyebrow="PRIVATE READING ARCHIVE"
          title={reference.title || "阅读缓存"}
          description={archive ? `阅读模式已在 ${formatDate(archive.updated_at)} 更新；原网页内容仅保存于本地后台。` : "尚未保存阅读缓存。请返回引用管理后点击“缓存正文”。"}
          actions={archive ? (
            <div className="flex items-center gap-3 text-sm">
              <a href={reference.url} target="_blank" rel="noopener noreferrer" className="text-neutral-500 no-underline hover:text-neutral-900">打开原文 ↗</a>
              <a href={`/api/admin/article-references/${reference.id}/original`} className="text-neutral-500 no-underline hover:text-neutral-900">下载原始快照</a>
            </div>
          ) : undefined}
        />
      </div>

      {!archive ? (
        <div className="admin-card rounded-2xl bg-white p-6 text-sm leading-6 text-neutral-500 shadow-sm">这个引用还没有本地阅读缓存。缓存只在管理员主动读取或更新时创建，不会对访客公开。</div>
      ) : (
        <article className="article-reference-reader admin-card bg-white shadow-sm">
          <header className="border-b border-neutral-200 pb-5">
            <p className="text-sm text-accent">{archive.source_name || "网页文章"}{archive.author ? ` · ${archive.author}` : ""}{archive.published_at ? ` · ${formatArticleReferenceDate(archive.published_at)}` : ""}</p>
            <h2 className="mt-2 text-2xl font-semibold leading-tight text-neutral-900 sm:text-3xl">{archive.title}</h2>
            <p className="mt-3 text-xs text-neutral-400">本地阅读快照：{formatDate(archive.captured_at)} · 已过滤导航、广告、脚本与推荐模块</p>
            {report.keptBlocks > 0 && (
              <div className="article-reference-reader-report" aria-label="缓存报告">
                <span>正文 {report.textCharacters.toLocaleString()} 字</span>
                <span>保留 {report.keptBlocks} 块</span>
                <span>清理 {report.removedBlocks} 块</span>
                <span>图片 {report.cachedImages + report.reusedImages} 张</span>
              </div>
            )}
          </header>
          {(archive.summary || archivePoints.length > 0) && (
            <aside className="mt-6 rounded-xl border border-accent/20 bg-accent/5 p-4">
              <p className="text-sm font-semibold text-accent">AI 摘要</p>
              {archive.summary && <p className="mt-2 text-sm leading-6 text-neutral-700">{archive.summary}</p>}
              {archivePoints.length > 0 && <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-neutral-600">{archivePoints.map((point) => <li key={point}>{point}</li>)}</ul>}
            </aside>
          )}
          <div
            className="article-reference-reader-content mt-7"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(archive.reader_markdown || referenceReaderHtmlToMarkdown(archive.reader_html)) }}
          />
        </article>
      )}
    </div>
  );
}
