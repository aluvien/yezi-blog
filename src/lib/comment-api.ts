import { after } from "next/server";
import { commentTargetExists, createComment, getMoment, getPost, getSiteSettings, lastCommentAgeByIp } from "@/lib/db";
import { getCommentAvatar } from "@/lib/author";
import { getClientIp } from "@/lib/request";
import { notifyNewComment } from "@/lib/telegram";

export type CommentResult = { data: unknown; status: number };

const RATE_LIMIT_MS = 30 * 1000; // 同 IP 30 秒内只能发 1 条

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function commentTargetLabel(targetType: "post" | "moment", targetId: number): string {
  if (targetType === "post") return getPost(targetId)?.title.trim() || "未命名文章";
  const content = getMoment(targetId)?.content ?? "";
  return content.replace(/\s+/g, " ").trim().slice(0, 90) || "未命名想法";
}

export async function submitComment(request: Request): Promise<CommentResult> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return { data: { error: "请求格式错误" }, status: 400 };
  }

  const targetType = body?.target_type;
  const targetId = Number(body?.target_id);
  const nickname = String(body?.nickname ?? "").trim();
  const email = String(body?.email ?? "").trim() || null;
  const website = String(body?.website_url ?? "").trim() || null;
  const content = String(body?.content ?? "").trim();
  // 隐形蜜罐字段：正常用户不可见，自动填表机器人通常会填写。
  const honeypot = String(body?.website ?? "").trim();

  // 蜜罐命中直接返回假成功，不落库也不触发限频，让机器人以为自己成功了。
  if (honeypot) {
    return { data: { message: "评论已提交，审核后展示" }, status: 201 };
  }

  if (targetType !== "post" && targetType !== "moment") {
    return { data: { error: "评论对象类型无效" }, status: 400 };
  }
  if (!Number.isInteger(targetId) || targetId <= 0 || !commentTargetExists(targetType, targetId)) {
    return { data: { error: "评论对象不存在" }, status: 400 };
  }
  if (!nickname || nickname.length > 30) {
    return { data: { error: "请填写昵称（30 字以内）" }, status: 400 };
  }
  if (email && (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
    return { data: { error: "邮箱格式不正确" }, status: 400 };
  }
  if (website && (website.length > 200 || !isHttpUrl(website))) {
    return { data: { error: "网站地址不正确" }, status: 400 };
  }
  if (!content || content.length > 1000) {
    return { data: { error: "请填写评论内容（1000 字以内）" }, status: 400 };
  }
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
