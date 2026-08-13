import crypto from "node:crypto";
import {
  claimArticleReferenceArchiveJob,
  completeArticleReferenceArchiveJob,
  countActiveArticleReferenceArchiveJobs,
  createArticleReferenceArchiveJobRecord,
  failArticleReferenceArchiveJob,
  findActiveArticleReferenceArchiveJob,
  getArticleReferenceArchiveJobRecord,
  listQueuedArticleReferenceArchiveJobs,
  pruneArticleReferenceArchiveJobs,
  recoverStaleArticleReferenceArchiveJobs,
  type ArticleReferenceArchiveJobRecord,
  type ArticleReferenceArchiveJobState,
} from "@/lib/db";
import { captureArticleReferenceArchive, type ReferenceArchiveReport } from "@/lib/article-reference-archive";
import { normalizeReferenceUrl } from "@/lib/article-reference-server";

export interface ArticleReferenceArchiveJob {
  id: string;
  url: string;
  state: ArticleReferenceArchiveJobState;
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

const MAX_ACTIVE_JOBS = 3;
const MAX_RETAINED_JOBS = 30;
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000;
const STALE_JOB_MS = 15 * 60 * 1000;

function safeError(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "缓存阅读正文失败";
}

function timestampToNumber(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function parseResult(value: string): ArticleReferenceArchiveJob["result"] | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as ArticleReferenceArchiveJob["result"];
  } catch {
    return undefined;
  }
}

function recordToJob(record: ArticleReferenceArchiveJobRecord): ArticleReferenceArchiveJob {
  const result = parseResult(record.result_json);
  return {
    id: record.id,
    url: record.url,
    state: record.state,
    createdAt: timestampToNumber(record.created_at),
    updatedAt: timestampToNumber(record.updated_at),
    ...(result ? { result } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

/**
 * 创建归档任务但不立即执行，路由用 after() 调度它。任务状态写入 SQLite，
 * 因此 PM2 重启或容器替换后仍可继续轮询，且启动时能够恢复中断的任务。
 */
export function createArticleReferenceArchiveJob(input: string): { job: ArticleReferenceArchiveJob; reused: boolean } {
  const url = normalizeReferenceUrl(input);
  pruneArticleReferenceArchiveJobs(MAX_RETAINED_JOBS, JOB_RETENTION_MS);
  const active = findActiveArticleReferenceArchiveJob(url);
  if (active) return { job: recordToJob(active), reused: true };
  if (countActiveArticleReferenceArchiveJobs() >= MAX_ACTIVE_JOBS) throw new Error("已有多个正文缓存任务正在执行，请稍后再试");

  const id = crypto.randomUUID();
  try {
    const record = createArticleReferenceArchiveJobRecord(id, url);
    return { job: recordToJob(record), reused: false };
  } catch (error) {
    // 多实例部署下另一个进程可能刚好插入了同一 URL；唯一索引保证只保留一个活动任务。
    const concurrent = findActiveArticleReferenceArchiveJob(url);
    if (concurrent) return { job: recordToJob(concurrent), reused: true };
    throw error;
  }
}

function startQueuedArticleReferenceArchiveJobs(): void {
  const availableSlots = Math.max(0, MAX_ACTIVE_JOBS - countActiveArticleReferenceArchiveJobs());
  for (const record of listQueuedArticleReferenceArchiveJobs(availableSlots)) {
    void runArticleReferenceArchiveJob(record.id);
  }
}

/** 由 route handler 的 after() 执行，任何异常都会保留为可见的具体错误。 */
export async function runArticleReferenceArchiveJob(jobId: string): Promise<void> {
  if (!claimArticleReferenceArchiveJob(jobId)) return;
  const running = getArticleReferenceArchiveJobRecord(jobId);
  if (!running) return;
  try {
    const result = await captureArticleReferenceArchive(running.url, { cacheImages: true });
    // 轮询只需要状态摘要；不要把可能数 MB 的正文 HTML/Markdown 在内存里再保留十分钟。
    completeArticleReferenceArchiveJob(jobId, {
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
    });
  } catch (error) {
    const message = safeError(error);
    failArticleReferenceArchiveJob(jobId, message);
    console.error("[article-reference-archive] job failed", { jobId, url: running.url, error: message });
  } finally {
    // 重启恢复时可能有超过并发上限的排队任务；当前任务结束后继续填充空闲槽位。
    startQueuedArticleReferenceArchiveJobs();
  }
}

export function getArticleReferenceArchiveJob(jobId: string): ArticleReferenceArchiveJob | null {
  const record = getArticleReferenceArchiveJobRecord(jobId);
  return record ? recordToJob(record) : null;
}

/**
 * 在 Node 实例启动时恢复上次进程中断的任务，并继续执行尚未开始的队列。
 * 只在 instrumentation 的运行时分支调用，构建阶段不会触碰任务表。
 */
export function resumeArticleReferenceArchiveJobs(): void {
  recoverStaleArticleReferenceArchiveJobs(new Date(Date.now() - STALE_JOB_MS).toISOString());
  pruneArticleReferenceArchiveJobs(MAX_RETAINED_JOBS, JOB_RETENTION_MS);
  startQueuedArticleReferenceArchiveJobs();
}
