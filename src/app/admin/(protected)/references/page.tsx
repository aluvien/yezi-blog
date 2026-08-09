import Link from "next/link";
import { articleReferenceCoverSrc, formatArticleReferenceDate } from "@/lib/article-reference";
import { listArticleReferences } from "@/lib/db";
import { formatDate } from "@/lib/format";

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
  const references = listArticleReferences();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-medium tracking-[0.14em] text-accent">ARTICLE REFERENCES</p>
        <h1 className="mt-1 text-xl font-bold">引用管理（{references.length}）</h1>
        <p className="mt-2 text-sm text-neutral-500">查看引用文章的来源、封面、日期、摘要和所在文章。正文中的引用标记已使用短格式保存。</p>
      </div>

      {references.length === 0 ? (
        <p className="rounded-2xl bg-white py-12 text-center text-sm text-neutral-400">还没有保存文章引用</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {references.map((reference) => {
            const points = parseKeyPoints(reference.key_points);
            const publishedAt = formatArticleReferenceDate(reference.published_at);
            return (
              <li key={reference.id} className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
                <div className="flex min-w-0 gap-3 sm:gap-4">
                  {reference.cover ? (
                    // 引用封面统一走服务端代理，避免公众号图片防盗链。
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={articleReferenceCoverSrc(reference.cover, reference.url)} alt="" className="h-20 w-20 shrink-0 rounded-xl object-cover sm:h-24 sm:w-24" />
                  ) : (
                    <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-2xl font-semibold text-accent sm:h-24 sm:w-24">引</div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-accent">
                      <span className="mr-1.5 rounded-full bg-accent/10 px-2 py-0.5 text-[11px]">#{reference.id}</span>
                      {reference.source_name || "网页文章"}
                      {reference.author ? ` · ${reference.author}` : ""}
                      {publishedAt ? ` · ${publishedAt}` : ""}
                    </p>
                    <a href={reference.url} target="_blank" rel="noopener noreferrer" className="mt-2 block text-base font-semibold text-neutral-800 no-underline hover:text-accent">
                      {reference.title}
                    </a>
                  </div>
                </div>

                <p className="mt-3 flex min-w-0 items-center gap-1.5 border-t border-neutral-100 pt-3 text-xs text-neutral-500">
                  <span className="shrink-0">引用网址：</span>
                  <a href={reference.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-neutral-700 no-underline hover:text-accent" title={reference.url}>{shortUrl(reference.url)}</a>
                </p>
                <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-neutral-500">
                  <span className="shrink-0">所在文章：</span>
                  <Link href={`/admin/posts/${reference.post_id}/edit`} className="min-w-0 truncate text-neutral-700 no-underline hover:text-accent">{reference.post_title}</Link>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 ${reference.post_status === "published" ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
                    {reference.post_status === "published" ? "已发布" : "草稿"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-100 pt-3 text-xs">
                  <span className={`rounded-full px-2 py-0.5 ${reference.summary || points.length > 0 ? "bg-accent/10 text-accent" : "bg-neutral-100 text-neutral-400"}`}>
                    {reference.summary || points.length > 0 ? "AI 摘要已生成" : "未生成 AI 摘要"}
                  </span>
                  <span className="text-neutral-400">最近同步：{formatDate(reference.updated_at)}</span>
                  {(reference.summary || points.length > 0) && (
                    <details className="ml-auto">
                      <summary className="cursor-pointer text-accent">查看摘要</summary>
                      <div className="mt-2 w-full rounded-lg bg-neutral-50 p-3 leading-5 text-neutral-600">
                        {reference.summary && <p>{reference.summary}</p>}
                        {points.length > 0 && <p className="mt-1">要点：{points.join(" · ")}</p>}
                      </div>
                    </details>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
