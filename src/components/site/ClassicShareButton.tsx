"use client";

import { useState } from "react";
import { Check, Link2, Share2 } from "lucide-react";

type ShareState = "idle" | "loading" | "copied" | "shared" | "error";

export function ClassicShareButton({ postId }: { postId: number }) {
  const [state, setState] = useState<ShareState>("idle");
  const [shortPath, setShortPath] = useState("");

  async function createShortLink(): Promise<string> {
    if (shortPath) return shortPath;
    const response = await fetch(`/api/posts/${postId}/short-link`, { method: "POST", headers: { accept: "application/json" } });
    const data = await response.json().catch(() => ({})) as { path?: string; error?: string };
    if (!response.ok || !data.path) throw new Error(data.error || "短链接生成失败");
    const path = data.path.startsWith("/") ? data.path : `/${data.path}`;
    setShortPath(path);
    return path;
  }

  async function copyText(value: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const input = document.createElement("input");
    input.value = value;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    return copied;
  }

  async function handleShare() {
    if (state === "loading") return;
    setState("loading");
    try {
      const path = await createShortLink();
      const url = new URL(path, window.location.origin).toString();
      const supportsNativeShare = typeof navigator.share === "function"
        && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
      if (supportsNativeShare) {
        await navigator.share({ title: document.title, url });
        setState("shared");
      } else {
        const copied = await copyText(url);
        if (!copied) throw new Error("复制失败");
        setState("copied");
      }
      window.setTimeout(() => setState("idle"), 1800);
    } catch (error) {
      // 用户主动取消系统分享不应显示错误提示。
      if (error instanceof DOMException && error.name === "AbortError") {
        setState("idle");
        return;
      }
      setState("error");
      window.setTimeout(() => setState("idle"), 2200);
    }
  }

  const label = state === "loading" ? "生成中…" : state === "copied" ? "链接已复制" : state === "shared" ? "已分享" : state === "error" ? "分享失败" : "生成并分享文章短链接";
  return (
    <button
      type="button"
      className="icon-button classic-share-button"
      aria-label={shortPath ? `分享短链接 ${shortPath}` : "生成并分享文章短链接"}
      title={shortPath ? `短链接：${shortPath}` : "生成并分享文章短链接"}
      onClick={() => void handleShare()}
      disabled={state === "loading"}
    >
      {state === "copied" ? <Check className="icon classic-share-button__icon" strokeWidth={2} aria-hidden="true" /> : state === "shared" ? <Share2 className="icon classic-share-button__icon" strokeWidth={2} aria-hidden="true" /> : shortPath ? <Link2 className="icon classic-share-button__icon" strokeWidth={2} aria-hidden="true" /> : <Share2 className="icon classic-share-button__icon" strokeWidth={2} aria-hidden="true" />}
      <span className="sr-only">{label}</span>
    </button>
  );
}
