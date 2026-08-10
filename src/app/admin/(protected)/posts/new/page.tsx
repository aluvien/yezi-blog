import PostForm from "@/components/admin/PostForm";
import { listAllTags, listCategories } from "@/lib/db";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export default function NewPostPage() {
  const categories = listCategories().map((c) => c.name);
  const usedTags = listAllTags();
  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader eyebrow="NEW POST" title="写文章" description="创建一篇文章，设置封面、分类、标签和正文内容。" />
      <PostForm categories={categories} usedTags={usedTags} />
    </div>
  );
}
