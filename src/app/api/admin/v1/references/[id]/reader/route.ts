import {
  adminError,
  adminInternalError,
  adminSuccess,
  authorizeAdminApi,
  parseAdminId,
} from "@/lib/admin-api";
import { parseArchiveReport, referenceReaderHtmlToMarkdown } from "@/lib/article-reference-archive";
import { getArticleReferenceArchive, getReferenceLibraryItem } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function referenceId(params: Promise<{ id: string }>): Promise<number | null> {
  return parseAdminId((await params).id);
}

/**
 * Native-admin reading cache payload.  It intentionally exposes only the
 * sanitized Markdown created by the archive pipeline, never the raw source
 * HTML or its private on-disk path.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authorizeAdminApi(request);
  if (!auth.ok) return auth.response;

  const id = await referenceId(params);
  if (id === null) return adminError("INVALID_ID", "引用 ID 必须是正整数", 400);

  try {
    const reference = getReferenceLibraryItem(id);
    if (!reference) return adminError("REFERENCE_NOT_FOUND", "引用不存在", 404);
    const archive = getArticleReferenceArchive(reference.canonical_url);
    if (!archive) return adminError("REFERENCE_ARCHIVE_NOT_FOUND", "该引用尚未缓存阅读正文", 404);

    const markdown = archive.reader_markdown.trim() || referenceReaderHtmlToMarkdown(archive.reader_html);
    return adminSuccess({
      id: reference.id,
      title: archive.title || reference.title,
      sourceName: archive.source_name || reference.source_name,
      author: archive.author || reference.author,
      publishedAt: archive.published_at || reference.published_at,
      summary: archive.summary || reference.summary,
      keyPoints: (() => {
        try {
          const parsed = JSON.parse(archive.key_points || "[]") as unknown;
          return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
        } catch {
          return [];
        }
      })(),
      markdown,
      capturedAt: archive.captured_at,
      updatedAt: archive.updated_at,
      report: parseArchiveReport(archive.cache_report),
      originalSnapshotPath: `/api/admin/article-references/${reference.id}/original`,
    });
  } catch (error) {
    return adminInternalError("get reference reader", error);
  }
}
