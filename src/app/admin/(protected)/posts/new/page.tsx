import PostForm from "@/components/admin/PostForm";
import { listAllTags, listCategories, listImageAttachments } from "@/lib/db";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export default async function NewPostPage({ searchParams }: { searchParams: Promise<{ reference?: string | string[] }> }) {
  const categories = listCategories().map((c) => c.name);
  const usedTags = listAllTags();
  const imageAttachments = listImageAttachments();
  const query = await searchParams;
  const openReferenceDialog = query.reference === "1";
  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader eyebrow="NEW POST" title="写文章" description="创建一篇文章，设置封面、分类、标签和正文内容。" />
      <PostForm categories={categories} usedTags={usedTags} availableImageAttachments={imageAttachments} openReferenceDialog={openReferenceDialog} />
    </div>
  );
}
