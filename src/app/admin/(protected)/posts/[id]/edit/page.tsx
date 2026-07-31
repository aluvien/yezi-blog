import { notFound } from "next/navigation";
import { getPost, getPostAttachments } from "@/lib/db";
import PostForm from "@/components/admin/PostForm";

export const dynamic = "force-dynamic";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = getPost(Number(id));
  if (!post) notFound();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">编辑文章</h1>
      <PostForm post={post} initialAttachments={getPostAttachments(post.id)} />
    </div>
  );
}
