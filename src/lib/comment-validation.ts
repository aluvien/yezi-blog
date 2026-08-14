export type ValidatedCommentInput = {
  targetType: "post" | "moment";
  targetId: number;
  nickname: string;
  email: string | null;
  website: string | null;
  content: string;
};

export type CommentInputValidation =
  | { kind: "valid"; input: ValidatedCommentInput }
  | { kind: "honeypot" }
  | { kind: "invalid"; error: string };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Validate all untrusted visitor fields before a comment is written to the database. */
export function validateCommentInput(
  body: Record<string, unknown>,
  targetExists: (targetType: "post" | "moment", targetId: number) => boolean,
): CommentInputValidation {
  const targetType = body.target_type;
  const targetId = Number(body.target_id);
  const nickname = String(body.nickname ?? "").trim();
  const email = String(body.email ?? "").trim() || null;
  const website = String(body.website_url ?? "").trim() || null;
  const content = String(body.content ?? "").trim();
  const honeypot = String(body.website ?? "").trim();

  // 蜜罐命中必须在其他字段之前返回，避免机器人藉由验证响应了解真实规则。
  if (honeypot) return { kind: "honeypot" };
  if (targetType !== "post" && targetType !== "moment") return { kind: "invalid", error: "评论对象类型无效" };
  if (!Number.isInteger(targetId) || targetId <= 0 || !targetExists(targetType, targetId)) return { kind: "invalid", error: "评论对象不存在" };
  if (!nickname || nickname.length > 30) return { kind: "invalid", error: "请填写昵称（30 字以内）" };
  if (email && (email.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return { kind: "invalid", error: "邮箱格式不正确" };
  if (website && (website.length > 200 || !isHttpUrl(website))) return { kind: "invalid", error: "网站地址不正确" };
  if (!content || content.length > 1000) return { kind: "invalid", error: "请填写评论内容（1000 字以内）" };
  return { kind: "valid", input: { targetType, targetId, nickname, email, website, content } };
}
