import { notFound } from "next/navigation";
import { getWork } from "@/lib/db";
import WorkForm from "@/components/admin/WorkForm";

export const dynamic = "force-dynamic";

export default async function EditWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = getWork(Number(id));
  if (!work) notFound();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">编辑作品</h1>
      <WorkForm work={work} />
    </div>
  );
}
