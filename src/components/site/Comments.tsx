"use client";

import { useState } from "react";
import { formatRelativeTime } from "@/lib/format";
import { site } from "@/lib/site";

export interface CommentItem {
  id: number;
  nickname: string;
  content: string;
  created_at: string;
  admin_reply: string | null;
  replied_at: string | null;
}

interface PendingCommentItem {
  id: number;
  nickname: string;
  content: string;
  created_at: string;
}

function avatarColor(name: string): string {
  const colors = [
    "#07c160", "#576b95", "#fa5151", "#ffc300",
    "#1aad19", "#3b7ddd", "#eb5757", "#f2994a",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const initial = name.charAt(0).toUpperCase();
  const bg = avatarColor(name);
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full text-white font-medium"
      style={{ width: size, height: size, backgroundColor: bg, fontSize: size * 0.4 }}
    >
      {initial}
    </div>
  );
}

/** 评论区：已审核评论列表 + 提交表单（蜜罐防垃圾、后台审核） */
export function Comments({
  targetType,
  targetId,
  comments,
}: {
  targetType: "post" | "moment";
  targetId: number;
  comments: CommentItem[];
}) {
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [content, setContent] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [submittedComments, setSubmittedComments] = useState<PendingCommentItem[]>([]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setMessage(null);
    setSubmitting(true);
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target_type: targetType,
          target_id: targetId,
          nickname: nickname.trim(),
          email: email.trim(),
          content: content.trim(),
          website,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        message?: string;
        comment?: PendingCommentItem;
      };
      if (res.status === 201) {
        setMessage({ ok: true, text: "评论已提交，将在审核后展示。" });
        if (data.comment) setSubmittedComments((current) => [...current, data.comment!]);
        setContent("");
      } else if (res.status === 429) {
        setMessage({ ok: false, text: "发布太频繁，请稍后再试。" });
      } else {
        setMessage({ ok: false, text: data.error ?? "提交失败，请稍后再试。" });
      }
    } catch {
      setMessage({ ok: false, text: "网络错误，请稍后再试。" });
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "w-full rounded-xl border border-neutral-200 bg-white px-3.5 py-2.5 text-[14px] outline-none transition-colors placeholder:text-neutral-400 focus:border-accent focus:ring-2 focus:ring-accent/10";

  return (
    <section className="mt-4">
      {(comments.length > 0 || submittedComments.length > 0) && (
        <ul className="space-y-5">
          {comments.map((c) => (
            <li key={c.id} className="flex gap-3">
              <Avatar name={c.nickname} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-medium text-foreground">{c.nickname}</span>
                  {c.nickname === site.author && (
                    <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[11px] text-accent font-medium">
                      作者
                    </span>
                  )}
                  <span className="text-[12px] text-muted">{formatRelativeTime(c.created_at)}</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">
                  {c.content}
                </p>
                {c.admin_reply && (
                  <div className="mt-3 rounded-xl bg-[#f5fbf8] px-3.5 py-3 text-[14px] leading-6 text-foreground/80">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-medium text-accent">{site.author} · 作者</span>
                      {c.replied_at && <span className="text-[11px] text-muted">{formatRelativeTime(c.replied_at)}</span>}
                    </div>
                    <p className="whitespace-pre-wrap">{c.admin_reply}</p>
                  </div>
                )}
              </div>
            </li>
          ))}
          {submittedComments.map((comment) => (
            <li key={`pending-${comment.id}`} className="flex gap-3 opacity-75">
              <Avatar name={comment.nickname} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-medium text-foreground">{comment.nickname}</span>
                  <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">待审核，仅你本次可见</span>
                  <span className="text-[12px] text-muted">刚刚</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground/90">{comment.content}</p>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={handleSubmit} className="mt-6 space-y-3 rounded-xl bg-neutral-50 p-4">
        <div className="absolute -left-[10000px] h-px w-px overflow-hidden" aria-hidden="true">
          <label htmlFor={`website-${targetType}-${targetId}`}>网站</label>
          <input
            id={`website-${targetType}-${targetId}`}
            name="website_url"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            tabIndex={-1}
            autoComplete="off"
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <input
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="昵称（必填）"
            maxLength={30}
            required
            className={inputCls}
          />
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱（选填，不公开）"
            type="email"
            maxLength={100}
            className={inputCls}
          />
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="写下你的想法…"
          maxLength={1000}
          required
          rows={3}
          className={`${inputCls} resize-y`}
        />
        <div className="-mt-1 text-right text-[11px] text-muted">{content.length}/1000</div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted">提交后经审核公开</span>
          <button
            type="submit"
            disabled={submitting}
            className="ml-auto shrink-0 rounded-lg bg-accent px-5 py-2.5 text-[14px] font-medium text-white shadow-sm shadow-accent/15 transition-transform hover:-translate-y-0.5 disabled:opacity-50"
          >
            {submitting ? "提交中…" : "提交"}
          </button>
        </div>
        {message && (
          <p role="status" className={`text-[14px] ${message.ok ? "text-accent" : "text-red-500"}`}>{message.text}</p>
        )}
      </form>
    </section>
  );
}
