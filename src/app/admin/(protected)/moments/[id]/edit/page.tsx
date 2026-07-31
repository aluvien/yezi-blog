import { notFound } from "next/navigation";
import { getMoment } from "@/lib/db";
import MomentForm from "@/components/admin/MomentForm";

export const dynamic = "force-dynamic";

export default async function EditMomentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const moment = getMoment(Number(id));
  if (!moment) notFound();

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">编辑想法</h1>
      <MomentForm moment={moment} />
    </div>
  );
}
