import { after } from "next/server";
import { commentTargetExists, createComment, getMoment, getPost, getSiteSettings, lastCommentAgeByIp } from "@/lib/db";
import { getCommentAvatar } from "@/lib/author";
import { validateCommentInput } from "@/lib/comment-validation";
import { getClientIp, readLimitedJson, RequestBodyError } from "@/lib/request";
import { notifyNewComment } from "@/lib/telegram";

export type CommentResult = { data: unknown; status: number };

const RATE_LIMIT_MS = 30 * 1000; // 同 IP 30 秒内只能发 1 条

function commentTargetLabel(targetType: "post" | "moment", targetId: number): string {
  if (targetType === "post") return getPost(targetId)?.title.trim() || "未命名文章";
  const content = getMoment(targetId)?.content ?? "";
  return content.replace(/\s+/g, " ").trim().slice(0, 90) || "未命名想法";
}

export async function submitComment(request: Request): Promise<CommentResult> {
  let body: Record<string, unknown>;
  try {
    body = await readLimitedJson<Record<string, unknown>>(request, 16 * 1024);
  } catch (error) {
    return { data: { error: error instanceof Error ? error.message : "请求格式错误" }, status: error instanceof RequestBodyError ? error.status : 400 };
  }

  const validation = validateCommentInput(body, commentTargetExists);
  if (validation.kind === "honeypot") {
    return { data: { message: "评论已提交，审核后展示" }, status: 201 };
  }
  if (validation.kind === "invalid") return { data: { error: validation.error }, status: 400 };
  const { targetType, targetId, nickname, email, website, content } = validation.input;
  const ip = getClientIp(request);
  const age = lastCommentAgeByIp(ip);
  if (age !== null && age < RATE_LIMIT_MS) {
    return { data: { error: "发布太频繁，请稍后再试" }, status: 429 };
  }

  const comment = createComment({ target_type: targetType, target_id: targetId, nickname, email, website, content, ip });
  const siteSettings = getSiteSettings();
  // `after` keeps the async delivery in the request lifecycle without making a
  // visitor wait for Telegram or allowing a delivery failure to reject a valid
  // comment submission.
  if (siteSettings.telegram_comment_notifications_enabled !== "0") {
    after(() => notifyNewComment({
      commentId: comment.id,
      nickname: comment.nickname,
      content: comment.content,
      targetType,
      targetLabel: commentTargetLabel(targetType, targetId),
    }));
  }
  return {
    data: {
      message: "评论已提交，审核后展示",
      comment: {
        id: comment.id,
        nickname: comment.nickname,
        avatar: getCommentAvatar(comment, siteSettings),
        content: comment.content,
        created_at: comment.created_at,
        status: comment.status,
      },
    },
    status: 201,
  };
}
