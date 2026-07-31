"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveCommentAction,
  deleteCommentAction,
  hideCommentAction,
  replyCommentAction,
} from "@/lib/actions/comments";

type Result = { ok: true } | { ok: false; error: string };

export default function CommentActions({
  id,
  status,
  initialReply,
}: {
  id: number;
  status: "pending" | "approved";
  initialReply: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editingReply, setEditingReply] = useState(false);
  const [reply, setReply] = useState(initialReply ?? "");
  const [error, setError] = useState("");

  function run(action: () => Promise<Result>, onSuccess?: () => void) {
    setError("");
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onSuccess?.();
      router.refresh();
    });
  }

  return (
    <div className="mt-3 border-t border-neutral-100 pt-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {status === "pending" ? (
          <button type="button" disabled={pending} onClick={() => run(() => approveCommentAction(id))} className="text-sm font-medium text-green-700 disabled:opacity-50">
            通过并公开
          </button>
        ) : (
          <button type="button" disabled={pending} onClick={() => run(() => hideCommentAction(id))} className="text-sm text-amber-700 disabled:opacity-50">
            撤回审核
          </button>
        )}
        <button type="button" disabled={pending} onClick={() => setEditingReply((value) => !value)} className="text-sm text-blue-700 disabled:opacity-50">
          {editingReply ? "收起回复" : initialReply ? "编辑作者回复" : "作者回复"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => {
            if (window.confirm("确定永久删除这条评论？")) run(() => deleteCommentAction(id));
          }}
          className="text-sm text-red-600 disabled:opacity-50"
        >
          删除
        </button>
        {pending && <span className="text-xs text-neutral-400">处理中…</span>}
      </div>

      {editingReply && (
        <div className="mt-3 space-y-2">
          <textarea
            value={reply}
            onChange={(event) => setReply(event.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="以作者身份回复这条评论"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm leading-6 outline-none focus:border-green-500"
          />
          <div className="flex items-center justify-between">
            <span className="text-xs text-neutral-400">{reply.length}/1000</span>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => replyCommentAction(id, reply), () => setEditingReply(false))}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {reply.trim() ? "保存回复" : "清除回复"}
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
    </div>
  );
}
