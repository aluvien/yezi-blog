import MomentForm from "@/components/admin/MomentForm";

export default function NewMomentPage() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-bold">发想法</h1>
      <MomentForm />
    </div>
  );
}
