import PostForm from "@/components/admin/PostForm";

export default function NewPostPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">写文章</h1>
      <PostForm />
    </div>
  );
}
