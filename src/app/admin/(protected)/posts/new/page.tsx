import PostForm from "@/components/admin/PostForm";
import { listAllTags, listCategories } from "@/lib/db";

export default function NewPostPage() {
  const categories = listCategories().map((c) => c.name);
  const usedTags = listAllTags();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">写文章</h1>
      <PostForm categories={categories} usedTags={usedTags} />
    </div>
  );
}
