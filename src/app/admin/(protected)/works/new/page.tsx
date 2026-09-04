import { listGithubRepositories } from "@/lib/db";
import WorkForm from "@/components/admin/WorkForm";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";

export const dynamic = "force-dynamic";

export default function NewWorkPage() {
  return (
    <div className="flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader eyebrow="LIFE · NEW WORK" title="添加作品" description="新增一个作品展示项目，设置封面、简介、链接、排序，并可关联 GitHub 仓库。" />
      <WorkForm repositories={listGithubRepositories()} />
    </div>
  );
}
