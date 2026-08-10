"use client";

import { useCallback, useEffect, useState } from "react";
import {
  articleReferenceCoverSrc,
  encodeArticleReferenceMarker,
  normalizeArticleReferenceSnapshot,
  type ArticleReferenceSnapshot,
} from "@/lib/article-reference";

type Props = { onClose: (marker: string | null) => void };

type PreviewResponse = { snapshot?: Partial<ArticleReferenceSnapshot>; error?: string };
type SummaryResponse = { configured?: boolean; summary?: string; keyPoints?: string[]; error?: string };
type HistoryResponse = { references?: ArticleReferenceSnapshot[]; error?: string };

async function fetchReferenceHistory(keyword: string): Promise<ArticleReferenceSnapshot[]> {
  const response = await fetch(`/api/admin/article-references/history?q=${encodeURIComponent(keyword)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as HistoryResponse;
  if (!response.ok) throw new Error(data.error || "读取历史引用失败");
  return data.references ?? [];
}

export function ArticleReferenceDialog({ onClose }: Props) {
  const [url, setUrl] = useState("");
  const [snapshot, setSnapshot] = useState<ArticleReferenceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState("");
  const [summaryMessage, setSummaryMessage] = useState("");
  const [historyKeyword, setHistoryKeyword] = useState("");
  const [history, setHistory] = useState<ArticleReferenceSnapshot[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");

  const loadHistory = useCallback(async (keyword: string) => {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      setHistory(await fetchReferenceHistory(keyword));
    } catch (reason) {
      setHistoryError(reason instanceof Error ? reason.message : "读取历史引用失败");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadHistory("");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHistory]);

  async function generateSummary(target: ArticleReferenceSnapshot) {
    setSummarizing(true);
    setSummaryMessage("");
    try {
      const response = await fetch("/api/admin/article-references/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: target.url }),
      });
      const data = await response.json().catch(() => ({})) as SummaryResponse;
      if (!response.ok) {
        setSummaryMessage(data.error || "AI 摘要暂时不可用，可直接插入引用");
        return;
      }
      if (data.configured === false) {
        setSummaryMessage("未配置 AI 摘要服务，可直接插入引用");
        return;
      }
      setSnapshot((current) => {
        if (!current || current.url !== target.url) return current;
        return normalizeArticleReferenceSnapshot({
          ...current,
          summary: data.summary ?? current.summary,
          keyPoints: data.keyPoints ?? current.keyPoints,
        });
      });
    } catch {
      setSummaryMessage("AI 摘要暂时不可用，可直接插入引用");
    } finally {
      setSummarizing(false);
    }
  }

  async function loadPreview() {
    const value = url.trim();
    if (!value) {
      setError("请粘贴文章网址");
      return;
    }
    setLoading(true);
    setError("");
    setSummaryMessage("");
    setSnapshot(null);
    try {
      const response = await fetch("/api/admin/article-references/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: value }),
      });
      const data = await response.json().catch(() => ({})) as PreviewResponse;
      if (!response.ok || !data.snapshot) throw new Error(data.error || "读取文章信息失败");
      const next = normalizeArticleReferenceSnapshot(data.snapshot);
      setSnapshot(next);
      // 摘要是可选增强：有配置时后台自动生成，没有配置时不阻塞插入。
      void generateSummary(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "读取文章信息失败");
    } finally {
      setLoading(false);
    }
  }

  function insert() {
    if (!snapshot) return;
    onClose(encodeArticleReferenceMarker(snapshot));
  }

  function selectHistory(item: ArticleReferenceSnapshot) {
    setSnapshot(item);
    setUrl(item.url);
    setError("");
    setSummaryMessage("");
  }

  return (
    <div
      className="fixed inset-0 z-[85] flex items-center justify-center bg-neutral-900/30 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose(null);
      }}
    >
      <div role="dialog" aria-modal="true" aria-labelledby="article-reference-dialog-title" className="max-h-[min(760px,calc(100dvh-2rem))] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="article-reference-dialog-title" className="text-base font-semibold text-neutral-900">引用文章</h2>
            <p className="mt-1 text-xs leading-5 text-neutral-500">粘贴公众号或网页文章链接，读取标题、来源和封面后插入引用卡片。</p>
          </div>
          <button type="button" aria-label="关闭对话框" onClick={() => onClose(null)} className="rounded-full p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">×</button>
        </div>

        <div className="mt-4 flex gap-2">
          <input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setSnapshot(null);
              setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void loadPreview();
              }
            }}
            placeholder="https://mp.weixin.qq.com/s/..."
            className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
          />
          <button type="button" disabled={loading} onClick={() => void loadPreview()} className="shrink-0 rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
            {loading ? "读取中…" : "读取信息"}
          </button>
        </div>

        <section className="mt-5 border-t border-neutral-200 pt-4" aria-label="历史引用">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-neutral-800">历史引用</h3>
              <p className="mt-0.5 text-xs text-neutral-400">默认显示最近 5 条，点击即可复用</p>
            </div>
            {historyLoading && <span className="text-xs text-neutral-400">读取中…</span>}
          </div>
          <div className="mt-2 flex gap-2">
            <input
              value={historyKeyword}
              onChange={(event) => setHistoryKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void loadHistory(historyKeyword);
                }
              }}
              placeholder="搜索标题、来源、作者或网址"
              className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
            />
            <button type="button" disabled={historyLoading} onClick={() => void loadHistory(historyKeyword)} className="shrink-0 rounded-lg border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50">搜索</button>
          </div>
          {historyError && <p className="mt-2 text-xs text-red-600">{historyError}</p>}
          {!historyLoading && !historyError && history.length === 0 && <p className="mt-3 text-xs text-neutral-400">没有找到匹配的历史引用</p>}
          {history.length > 0 && (
            <div className="mt-3 flex flex-col gap-2">
              {history.map((item) => (
                <button
                  key={`${item.canonicalUrl || item.url}-${item.title}`}
                  type="button"
                  onClick={() => selectHistory(item)}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors ${snapshot?.canonicalUrl === item.canonicalUrl ? "border-accent/50 bg-accent/5" : "border-neutral-200 hover:border-accent/30 hover:bg-neutral-50"}`}
                >
                  {item.cover ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={articleReferenceCoverSrc(item.cover, item.url)} alt="" referrerPolicy="no-referrer" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-lg font-semibold text-accent">引</span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-accent">{item.source || "网页文章"}{item.author ? ` · ${item.author}` : ""}</span>
                    <span className="mt-0.5 block line-clamp-2 text-sm font-medium leading-5 text-neutral-800">{item.title}</span>
                    {item.publishedAt && <span className="mt-0.5 block text-[11px] text-neutral-400">{item.publishedAt}</span>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        {snapshot && (
          <div className="mt-4 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
            <div className="flex gap-3">
              {snapshot.cover ? (
                // 外部封面统一走本站代理，避免公众号图片的防盗链和混合内容问题。
                // eslint-disable-next-line @next/next/no-img-element
                <img src={articleReferenceCoverSrc(snapshot.cover, snapshot.url)} alt="" referrerPolicy="no-referrer" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-2xl font-semibold text-accent">引</div>
              )}
              <div className="min-w-0">
                <p className="text-xs text-accent">{snapshot.source || "网页文章"}{snapshot.author ? ` · ${snapshot.author}` : ""}</p>
                <h3 className="mt-1 line-clamp-2 text-base font-semibold leading-6 text-neutral-900">{snapshot.title}</h3>
                {snapshot.publishedAt && <p className="mt-1 text-xs text-neutral-400">{snapshot.publishedAt}</p>}
              </div>
            </div>
            {(summarizing || snapshot.summary || snapshot.keyPoints.length > 0 || summaryMessage) && (
              <div className="mt-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2.5">
                <p className="text-xs font-medium text-accent">{summarizing ? "AI 摘要生成中…" : "AI 摘要"}</p>
                {snapshot.summary && <p className="mt-1 text-sm leading-6 text-neutral-700">{snapshot.summary}</p>}
                {snapshot.keyPoints.length > 0 && <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-neutral-600">{snapshot.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul>}
                {!summarizing && !snapshot.summary && snapshot.keyPoints.length === 0 && summaryMessage && <p className="mt-1 text-xs leading-5 text-neutral-500">{summaryMessage}</p>}
              </div>
            )}
          </div>
        )}

        <p className="mt-3 text-xs leading-5 text-neutral-400">标题可直接打开原文；引用卡片只保存标题、来源、封面和摘要快照，正文访问时不会再次请求原网页。</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => onClose(null)} className="rounded-lg border border-neutral-300 px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-50">取消</button>
          {snapshot && !summarizing && !snapshot.summary && <button type="button" onClick={() => void generateSummary(snapshot)} className="rounded-lg border border-accent/40 px-3.5 py-2 text-sm text-accent hover:bg-accent/5">生成 AI 摘要</button>}
          <button type="button" disabled={!snapshot} onClick={insert} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-40">插入引用</button>
        </div>
      </div>
    </div>
  );
}
