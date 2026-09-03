import { listGithubRepositories } from "@/lib/db";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";
import GithubAdminPanel from "@/components/admin/GithubAdminPanel";

export const dynamic = "force-dynamic";

export default function AdminGithubPage() {
  const repositories = listGithubRepositories();
  return (
    <div className="flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader
        eyebrow="LIFE · GITHUB"
        title={`GitHub 仓库（${repositories.length}）`}
        description="登记你自己的 GitHub 仓库并同步公开元数据。自动同步字段与自定义展示字段互不覆盖，前台只读数据库快照。"
      />
      <GithubAdminPanel repositories={repositories} />
    </div>
  );
}
