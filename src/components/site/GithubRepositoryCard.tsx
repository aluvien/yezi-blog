import { Star, GitFork, Circle } from "lucide-react";
import type { GithubRepository } from "@/lib/db";
import { parseGithubTopics, githubDisplayTitle, githubDisplayDescription } from "@/lib/github-presentation";

/**
 * 前台仓库卡片。优先展示站长自定义内容（custom_title/description/cover/tags），
 * 其次才是自动同步来的字段；绝不渲染 sync_error 等内部诊断信息。
 */
export function GithubRepositoryCard({ repository }: { repository: GithubRepository }) {
  const title = githubDisplayTitle(repository);
  const description = githubDisplayDescription(repository);
  const topics = parseGithubTopics(repository);
  const tags = parseTags(repository.tags);
  const pushed = repository.pushed_at ? repository.pushed_at.slice(0, 10) : "";

  return (
    <article className="paper-card group flex h-full flex-col gap-3 rounded-2xl p-4 transition-transform duration-300 hover:-translate-y-0.5 sm:p-5">
      {repository.cover ? (
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xl bg-soft">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={repository.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        </div>
      ) : null}
      <div className="min-w-0">
        <div className="flex items-start justify-between gap-3">
          <h2 className="min-w-0 break-words text-[17px] font-semibold leading-6 tracking-[-0.02em] text-foreground sm:text-[19px]">
            <a href={repository.repo_url} target="_blank" rel="noopener noreferrer" className="no-underline transition-colors hover:text-accent">{title}</a>
          </h2>
          <span className="shrink-0 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-accent">↗</span>
        </div>
        <p className="mt-0.5 truncate text-[12px] text-muted" title={repository.full_name}>{repository.full_name}</p>
        {description && <p className="mt-2 line-clamp-3 text-[13px] leading-6 text-muted">{description}</p>}
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted">
          {repository.primary_language && (
            <span className="inline-flex items-center gap-1"><Circle className="h-2.5 w-2.5 fill-current text-accent" strokeWidth={0} aria-hidden="true" />{repository.primary_language}</span>
          )}
          <span className="inline-flex items-center gap-1" aria-label={`星标 ${repository.stars}`}><Star className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />{repository.stars}</span>
          <span className="inline-flex items-center gap-1" aria-label={`分支 ${repository.forks}`}><GitFork className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden="true" />{repository.forks}</span>
          {pushed && <span className="text-muted">更新于 {pushed}</span>}
        </div>
        {(topics.length > 0 || tags.length > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tags.map((tag) => <span key={`t-${tag}`} className="inline-flex max-w-full items-center rounded-full bg-accent/10 px-2.5 py-1 text-[11px] text-accent">#{tag}</span>)}
            {topics.map((topic) => <span key={`tp-${topic}`} className="inline-flex max-w-full items-center rounded-full bg-soft px-2.5 py-1 text-[11px] text-muted">{topic}</span>)}
          </div>
        )}
      </div>
    </article>
  );
}

function parseTags(raw: string): string[] {
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
