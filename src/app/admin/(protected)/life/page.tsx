import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default function AdminLifeIndex() {
  redirect("/admin/life/milestones");
}
