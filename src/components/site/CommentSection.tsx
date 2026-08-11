import { getSiteSettings, listApprovedComments } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getSiteAuthor } from "@/lib/site";
import { getAuthorAvatar, getCommentAvatar } from "@/lib/author";
import { Comments } from "@/components/site/Comments";

/** 服务端包装：取已审核评论与管理员登录态后交给客户端组件 */
export async function CommentSection({
  targetType,
  targetId,
  defaultFormCollapsed,
  commentCount,
  authorName,
}: {
  targetType: "post" | "moment";
  targetId: number;
  defaultFormCollapsed?: boolean;
  commentCount?: number;
  authorName?: string;
}) {
  const siteSettings = getSiteSettings();
  const comments = listApprovedComments(targetType, targetId).map((c) => ({
    id: c.id,
    nickname: c.nickname,
    avatar: getCommentAvatar(c, siteSettings),
    content: c.content,
    created_at: c.created_at,
    admin_reply: c.admin_reply,
    replied_at: c.replied_at,
  }));
  // 登录态只在服务端判定，前台据此显示"回复"按钮；真正写入仍由 replyCommentAction 的 requireAdmin 兜底。
  const isAdmin = !!(await getSession());
  const displayAuthor = authorName?.trim() || getSiteAuthor(siteSettings);
  return (
    <Comments
      targetType={targetType}
      targetId={targetId}
      comments={comments}
      defaultFormCollapsed={defaultFormCollapsed}
      commentCount={commentCount}
      isAdmin={isAdmin}
      authorName={displayAuthor}
      authorAvatar={getAuthorAvatar(siteSettings)}
      authorAvatarNoBorder={siteSettings.author_avatar_no_border === "1"}
    />
  );
}
