import { notFound } from "next/navigation";
import { getPost, getPostAttachments, listAllTags, listArticleReferenceSnapshotsForPost, listCategories } from "@/lib/db";
import PostForm from "@/components/admin/PostForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const post = getPost(Number(id));
  if (!post) notFound();
  const categories = listCategories().map((c) => c.name);
  const usedTags = listAllTags();
  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader eyebrow="EDIT POST" title="编辑文章" description="修改文章正文、封面、分类、标签和发布状态。" />
      <PostForm post={post} initialAttachments={getPostAttachments(post.id)} initialReferences={listArticleReferenceSnapshotsForPost(post.id)} categories={categories} usedTags={usedTags} />
    </div>
  );
}
