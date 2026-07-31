import WorkForm from "@/components/admin/WorkForm";

export default function NewWorkPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">添加作品</h1>
      <WorkForm />
    </div>
  );
}
