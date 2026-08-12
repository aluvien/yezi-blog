import crypto from "node:crypto";
import { captureArticleReferenceArchive, type ReferenceArchiveReport } from "@/lib/article-reference-archive";
import { normalizeReferenceUrl } from "@/lib/article-reference-server";

type JobState = "queued" | "running" | "completed" | "failed";

export interface ArticleReferenceArchiveJob {
  id: string;
  url: string;
  state: JobState;
  createdAt: number;
  updatedAt: number;
  result?: {
    archive: { canonical_url: string; title: string; captured_at: string; updated_at: string };
    created: boolean;
    cachedImages: number;
    aiApplied: boolean;
    summaryGenerated: boolean;
    report: ReferenceArchiveReport;
    unchanged: boolean;
    aiError?: string;
  };
  error?: string;
}

type ArchiveJobStore = {
  jobs: Map<string, ArticleReferenceArchiveJob>;
  activeByUrl: Map<string, string>;
};

const globalForArchiveJobs = globalThis as typeof globalThis & { __articleReferenceArchiveJobs?: ArchiveJobStore };
const store: ArchiveJobStore = globalForArchiveJobs.__articleReferenceArchiveJobs
  ?? (globalForArchiveJobs.__articleReferenceArchiveJobs = { jobs: new Map(), activeByUrl: new Map() });
const MAX_ACTIVE_JOBS = 3;
const MAX_RETAINED_JOBS = 30;

function safeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "缓存阅读正文失败";
}

function activeJobFor(url: string): ArticleReferenceArchiveJob | null {
  const id = store.activeByUrl.get(url);
  const job = id ? store.jobs.get(id) : undefined;
  if (!job || (job.state !== "queued" && job.state !== "running")) {
    store.activeByUrl.delete(url);
    return null;
  }
  return job;
}

/**
 * 创建归档任务但不立即执行，路由用 after() 调度它。这样浏览器请求能立刻结束，
 * 不会被反向代理的单请求超时中断。
 */
export function createArticleReferenceArchiveJob(input: string): { job: ArticleReferenceArchiveJob; reused: boolean } {
  const url = normalizeReferenceUrl(input);
  const active = activeJobFor(url);
  if (active) return { job: active, reused: true };
  if (store.activeByUrl.size >= MAX_ACTIVE_JOBS) throw new Error("已有多个正文缓存任务正在执行，请稍后再试");

  while (store.jobs.size >= MAX_RETAINED_JOBS) {
    const removable = [...store.jobs.values()]
      .filter((item) => item.state === "completed" || item.state === "failed")
      .sort((a, b) => a.updatedAt - b.updatedAt)[0];
    if (!removable) break;
    store.jobs.delete(removable.id);
  }

  const now = Date.now();
  const job: ArticleReferenceArchiveJob = {
    id: crypto.randomUUID(),
    url,
    state: "queued",
    createdAt: now,
    updatedAt: now,
  };
  store.jobs.set(job.id, job);
  store.activeByUrl.set(url, job.id);
  return { job, reused: false };
}

/** 由 route handler 的 after() 执行，任何异常都会保留为可见的具体错误。 */
export async function runArticleReferenceArchiveJob(jobId: string): Promise<void> {
  const job = store.jobs.get(jobId);
  if (!job || job.state !== "queued") return;
  job.state = "running";
  job.updatedAt = Date.now();
  try {
    const result = await captureArticleReferenceArchive(job.url, { cacheImages: true });
    // 轮询只需要状态摘要；不要把可能数 MB 的正文 HTML/Markdown 在内存里再保留十分钟。
    job.result = {
      archive: {
        canonical_url: result.archive.canonical_url,
        title: result.archive.title,
        captured_at: result.archive.captured_at,
        updated_at: result.archive.updated_at,
      },
      created: result.created,
      cachedImages: result.cachedImages,
      aiApplied: result.aiApplied,
      summaryGenerated: result.summaryGenerated,
      report: result.report,
      unchanged: result.unchanged,
      aiError: result.aiError,
    };
    job.state = "completed";
  } catch (error) {
    job.error = safeError(error);
    job.state = "failed";
    console.error("[article-reference-archive] job failed", { jobId, url: job.url, error: job.error });
  } finally {
    job.updatedAt = Date.now();
    store.activeByUrl.delete(job.url);
    // 结果供当前页面轮询，保留 10 分钟；随后自动释放内存。
    setTimeout(() => store.jobs.delete(jobId), 10 * 60 * 1000).unref?.();
  }
}

export function getArticleReferenceArchiveJob(jobId: string): ArticleReferenceArchiveJob | null {
  return store.jobs.get(jobId) ?? null;
}
