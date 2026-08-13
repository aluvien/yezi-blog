"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  referenceId: number;
  url: string;
  cached: boolean;
  variant?: "source" | "summary";
};

type ArchiveResponse = {
  job?: {
    id?: string;
    state?: "queued" | "running" | "completed" | "failed";
    error?: string;
    archive?: { capturedAt?: string };
    created?: boolean;
    unchanged?: boolean;
    cachedImages?: number;
    report?: { keptBlocks?: number; removedBlocks?: number; cachedImages?: number; reusedImages?: number; quality?: "good" | "review" | "poor" };
    ai?: { applied?: boolean; summaryGenerated?: boolean; error?: string };
  };
  reused?: boolean;
  error?: string;
};

export function ArticleReferenceArchiveActions({ referenceId, url, cached, variant = "summary" }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function readResponse(response: Response): Promise<ArchiveResponse> {
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) return response.json() as Promise<ArchiveResponse>;
    const text = (await response.text()).replace(/\s+/g, " ").trim();
    const detail = text ? `（${text.slice(0, 120)}）` : "";
    throw new Error(`服务器未返回有效结果（HTTP ${response.status}）${detail}`);
  }

  async function waitForJob(jobId: string): Promise<NonNullable<ArchiveResponse["job"]>> {
    for (let attempt = 0; attempt < 250; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const response = await fetch(`/api/admin/article-references/archive?job=${encodeURIComponent(jobId)}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      const data = await readResponse(response);
      if (!response.ok || !data.job) throw new Error(data.error || `读取归档进度失败（HTTP ${response.status}）`);
      if (data.job.state === "queued" || data.job.state === "running") {
        setNotice(data.job.state === "queued" ? "正在排队读取原文…" : "正在读取原文、缓存图片并生成 AI 摘要…");
        continue;
      }
      if (data.job.state === "failed") throw new Error(data.job.error || "读取文章失败，请检查网址是否可访问");
      return data.job;
    }
    throw new Error("归档仍在进行中，请稍后刷新页面查看结果");
  }

  async function cacheReader() {
    setLoading(true);
    setError("");
    setNotice("正在读取原文并缓存图片…");
    try {
      const response = await fetch("/api/admin/article-references/archive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ url, cacheImages: true }),
      });
      const data = await readResponse(response);
      if (!response.ok || !data.job?.id) throw new Error(data.error || `创建归档任务失败（HTTP ${response.status}）`);
      setNotice(data.reused ? "正在继续已有的后台更新，可留在当前页面等待结果…" : "已开始后台更新，可留在当前页面等待结果…");
      const job = await waitForJob(data.job.id);
      const action = job.unchanged ? "原文没有变化，已复用现有缓存" : job.created ? "已保存阅读缓存" : "正文已更新";
      const aiNote = job.ai?.summaryGenerated ? "，AI 摘要已更新" : job.ai?.applied ? "，AI 已筛除无关内容" : job.ai?.error ? `，AI 未处理：${job.ai.error}` : "";
      const reportNote = job.report ? `，保留 ${job.report.keptBlocks ?? 0} 块、清理 ${job.report.removedBlocks ?? 0} 块` : "";
      setNotice(`${action}（图片 ${job.cachedImages ?? 0} 张${reportNote}${aiNote}）`);
      // 先保留可见的成功反馈；随后的刷新更新“阅读缓存时间”和下载链接，
      // 避免立即 refresh 把状态销毁后让人误以为按钮没有响应。
      window.setTimeout(() => router.refresh(), 3_500);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "缓存阅读正文失败");
    } finally {
      setLoading(false);
    }
  }

  if (variant === "source") {
    return (
      <div className="admin-reference-source-actions">
        {cached && <a href={`/api/admin/article-references/${referenceId}/original`} className="no-underline">下载原始快照</a>}
        <button type="button" disabled={loading} onClick={() => void cacheReader()}>
          {loading ? "更新中…" : "更新正文"}
        </button>
        {notice && <span className="admin-reference-action-success">{notice}</span>}
        {error && <span className="admin-reference-action-error">{error}</span>}
      </div>
    );
  }

  return (
    <div className="admin-reference-cache-action">
      {cached && <Link href={`/admin/references/${referenceId}/reader`} className="no-underline">阅读缓存</Link>}
      {notice && <span className="admin-reference-action-success">{notice}</span>}
      {error && <span className="admin-reference-action-error">{error}</span>}
    </div>
  );
}
