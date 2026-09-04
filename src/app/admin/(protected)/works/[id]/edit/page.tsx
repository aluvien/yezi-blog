import { notFound } from "next/navigation";
import { getWork, listGithubRepositories, listRepositoryIdsForWork } from "@/lib/db";
import WorkForm from "@/components/admin/WorkForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";

export const dynamic = "force-dynamic";

export default async function EditWorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const work = getWork(Number(id));
  if (!work) notFound();

  return (
    <div className="flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader eyebrow="LIFE · EDIT WORK" title="编辑作品" description="修改作品展示内容、封面、链接、排序与关联的 GitHub 仓库。" />
      <WorkForm work={work} repositories={listGithubRepositories()} initialRepositoryIds={listRepositoryIdsForWork(work.id)} />
    </div>
  );
}
