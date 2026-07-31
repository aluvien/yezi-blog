import { listApprovedComments } from "@/lib/db";
import { Comments } from "@/components/site/Comments";

/** 服务端包装：取已审核评论后交给客户端组件 */
export function CommentSection({ targetType, targetId }: { targetType: "post" | "moment"; targetId: number }) {
  const comments = listApprovedComments(targetType, targetId).map((c) => ({
    id: c.id,
    nickname: c.nickname,
    content: c.content,
    created_at: c.created_at,
    admin_reply: c.admin_reply,
    replied_at: c.replied_at,
  }));
  return <Comments targetType={targetType} targetId={targetId} comments={comments} />;
}
