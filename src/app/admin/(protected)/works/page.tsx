import Link from "next/link";
import { listWorks } from "@/lib/db";
import { deleteWorkAction } from "@/lib/actions/works";
import DeleteButton from "@/components/admin/DeleteButton";
import AdminPageHeader from "@/components/admin/AdminPageHeader";

export const dynamic = "force-dynamic";

export default function AdminWorksPage() {
  const works = listWorks();

  return (
    <div className="flex flex-col gap-4">
      <AdminPageHeader
        eyebrow="WORKS"
        title={`作品（${works.length}）`}
        description="管理作品展示内容、封面、链接和排序。"
        actions={(
          <Link
            href="/admin/works/new"
            className="admin-button admin-button-primary rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white active:bg-neutral-700"
          >
            + 添加作品
          </Link>
        )}
      />
      {works.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">还没有作品</p>}
      <ul className="flex flex-col gap-2">
        {works.map((work) => (
          <li key={work.id} className="admin-card admin-content-card flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
            {work.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={work.cover} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 object-cover" />
            ) : (
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-neutral-100 text-xs text-neutral-400">
                无图
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-medium">{work.title}</p>
              <p className="mt-0.5 truncate text-xs text-neutral-400">
                排序 {work.sort_order}
                {work.link && ` · ${work.link}`}
              </p>
            </div>
            <div className="basis-full flex shrink-0 flex-wrap gap-x-4 gap-y-2 border-t border-neutral-100 pl-[4.25rem] pt-3">
              {work.link && <a href={work.link} target="_blank" rel="noopener noreferrer" className="admin-action-link admin-action-link-primary text-sm text-blue-700">查看</a>}
              <Link href={`/admin/works/${work.id}/edit`} className="admin-action-link admin-action-link-primary text-sm text-neutral-700">
                编辑
              </Link>
              <DeleteButton action={deleteWorkAction.bind(null, work.id)} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
