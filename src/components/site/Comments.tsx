"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatRelativeTime } from "@/lib/format";
import { site } from "@/lib/site";
import { replyCommentAction } from "@/lib/actions/comments";

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

function Avatar({ name }: { name: string }) {
  const initial = name.charAt(0).toUpperCase();
  const bg = avatarColor(name);
  return (
    <div
      className="comment-avatar"
      style={{ backgroundColor: bg }}
      aria-hidden="true"
    >
      {initial}
    </div>
  );
}

/** 评论区：已审核评论列表 + 提交表单（蜜罐防垃圾、后台审核）。
 *  文章页传 commentCount：渲染标题行（标题 + “写评论”按钮同一行，不额外占高），表单默认折叠，点击展开并滚动到位。
 *  想法页不传 commentCount：无标题行，表单默认展开。
 *  isAdmin（管理员已登录）时每条评论可"回复"：以 UP 主身份就地回复，嵌套展示在该评论下方。 */
export function Comments({
  targetType,
  targetId,
  comments,
  defaultFormCollapsed = false,
  commentCount,
  isAdmin = false,
}: {
  targetType: "post" | "moment";
  targetId: number;
  comments: CommentItem[];
  defaultFormCollapsed?: boolean;
  commentCount?: number;
  isAdmin?: boolean;
}) {
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [profileUrl, setProfileUrl] = useState("");
  const [content, setContent] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [submittedComments, setSubmittedComments] = useState<PendingCommentItem[]>([]);
  const [formCollapsed, setFormCollapsed] = useState(defaultFormCollapsed);
  const formRef = useRef<HTMLFormElement>(null);
  // 管理员就地回复：当前正在回复的评论 id、输入内容与提交态
  const [replyingTo, setReplyingTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const [replying, startTransition] = useTransition();

  async function submitReply(commentId: number) {
    const text = replyText.trim();
    if (!text || replying) return;
    setReplyError("");
    startTransition(async () => {
      const result = await replyCommentAction(commentId, text);
      if (!result.ok) {
        setReplyError(result.error);
        return;
      }
      setReplyingTo(null);
      setReplyText("");
      router.refresh();
    });
  }

  function openReply(commentId: number) {
    setReplyText("");
    setReplyError("");
    setReplyingTo(commentId);
  }

  function cancelReply() {
    setReplyingTo(null);
    setReplyText("");
    setReplyError("");
  }

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
          website_url: profileUrl.trim(),
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

  function expandForm() {
    setFormCollapsed(false);
    // 表单在列表下方，展开后平滑滚动到表单（scrollIntoView 会自动找最近的滚动祖先，桌面端即 .site-main）
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  const inputCls = "comment-field";
  const showHeader = commentCount !== undefined;
  // 头部计数与下方列表保持一致：已审核评论 + 本次会话刚提交（待审核）的评论
  const shownCount = showHeader ? commentCount! + submittedComments.length : 0;

  return (
    <section className="comments-content">
      {showHeader && (
        <div className="comment-header-row mb-5 flex items-center justify-between gap-3">
          <h2 className="comments-title" style={{ margin: 0, lineHeight: 1 }}>
            {shownCount > 0 ? `${shownCount} 条精选留言` : "还没有留言"}
          </h2>
          {formCollapsed ? (
            <button
              type="button"
              onClick={expandForm}
              aria-expanded="false"
              className="inline-flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 text-[13px] leading-none text-muted transition-colors hover:bg-soft hover:text-accent"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M12 8v6M9 11h6" />
              </svg>
              写评论
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setFormCollapsed(true)}
              aria-expanded="true"
              className="inline-flex shrink-0 items-center rounded px-2 py-0.5 text-[13px] leading-none text-muted transition-colors hover:bg-soft hover:text-accent"
            >
              收起
            </button>
          )}
        </div>
      )}

      {/* 评论列表（常显，提供社会证明） */}
      {(comments.length > 0 || submittedComments.length > 0) && (
        <ul className="comments-list">
          {comments.map((c) => (
            <li key={c.id} className="comment-item">
              <Avatar name={c.nickname} />
              <div className="comment-body">
                <div className="comment-meta">
                  <span className="comment-author">{c.nickname}</span>
                  {c.nickname === site.author && <span className="comment-author-badge">UP主</span>}
                  <span className="comment-time">{formatRelativeTime(c.created_at)}</span>
                  {isAdmin && replyingTo !== c.id && (
                    <button type="button" className="comment-reply-btn" onClick={() => openReply(c.id)}>
                      回复
                    </button>
                  )}
                </div>
                <div className="comment-content">{c.content}</div>
                {c.admin_reply && (
                  <div className="comment-children">
                    <div className="comment-item comment-item-reply">
                      <Avatar name={site.author} />
                      <div className="comment-body">
                        <div className="comment-meta">
                          <span className="comment-author">{site.author}</span>
                          <span className="comment-author-badge">UP主</span>
                          {c.replied_at && <span className="comment-time">{formatRelativeTime(c.replied_at)}</span>}
                        </div>
                        <div className="comment-content">{c.admin_reply}</div>
                      </div>
                    </div>
                  </div>
                )}
                {isAdmin && replyingTo === c.id && (
                  <form
                    className="comment-reply-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitReply(c.id);
                    }}
                  >
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="以 UP 主身份回复…"
                      maxLength={1000}
                      rows={2}
                      autoFocus
                      className="comment-field"
                    />
                    {replyError && <p className="comment-reply-error">{replyError}</p>}
                    <div className="comment-reply-actions">
                      <button type="button" onClick={cancelReply} className="comment-reply-cancel">取消</button>
                      <button type="submit" disabled={replying} className="comment-reply-submit">{replying ? "回复中…" : "回复"}</button>
                    </div>
                  </form>
                )}
              </div>
            </li>
          ))}
          {submittedComments.map((comment) => (
            <li key={`pending-${comment.id}`} className="comment-item is-pending">
              <Avatar name={comment.nickname} />
              <div className="comment-body">
                <div className="comment-meta">
                  <span className="comment-author">{comment.nickname}</span>
                  <span className="comment-status">待审核，仅你本次可见</span>
                  <span className="comment-time">刚刚</span>
                </div>
                <div className="comment-content">{comment.content}</div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 表单：折叠时隐藏，展开后显示在列表下方 */}
      {!formCollapsed && (
        <form ref={formRef} onSubmit={handleSubmit} className="comments-form">
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
          <div className="comment-form-row">
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
            <input
              value={profileUrl}
              onChange={(e) => setProfileUrl(e.target.value)}
              placeholder="网站（选填）"
              type="url"
              maxLength={200}
              className={inputCls}
            />
          </div>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="写下你的想法…"
            maxLength={1000}
            required
            rows={4}
            className={`${inputCls} resize-y`}
          />
          <div className="comment-form-actions">
            <button
              type="submit"
              disabled={submitting}
              className="comment-submit"
            >
              {submitting ? "提交中…" : "提交"}
            </button>
          </div>
          {message && (
            <p role="status" className={`comment-form-message ${message.ok ? "is-success" : "is-error"}`}>{message.text}</p>
          )}
        </form>
      )}
    </section>
  );
}
