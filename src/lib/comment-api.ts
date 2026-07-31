import { commentTargetExists, createComment, lastCommentAgeByIp } from "@/lib/db";

export type CommentResult = { data: unknown; status: number };

const RATE_LIMIT_MS = 30 * 1000; // 同 IP 30 秒内只能发 1 条

function getIp(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return request.headers.get("x-real-ip") ?? "unknown";
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
  const content = String(body?.content ?? "").trim();
  const website = String(body?.website ?? "").trim();

  // 隐形蜜罐字段：正常用户不可见，自动填表机器人通常会填写。
  if (website) {
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
  if (!content || content.length > 1000) {
    return { data: { error: "请填写评论内容（1000 字以内）" }, status: 400 };
  }
  const ip = getIp(request);
  const age = lastCommentAgeByIp(ip);
  if (age !== null && age < RATE_LIMIT_MS) {
    return { data: { error: "发布太频繁，请稍后再试" }, status: 429 };
  }

  const comment = createComment({ target_type: targetType, target_id: targetId, nickname, email, content, ip });
  return {
    data: {
      message: "评论已提交，审核后展示",
      comment: {
        id: comment.id,
        nickname: comment.nickname,
        content: comment.content,
        created_at: comment.created_at,
        status: comment.status,
      },
    },
    status: 201,
  };
}
