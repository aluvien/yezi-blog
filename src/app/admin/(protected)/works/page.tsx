import Link from "next/link";
import { listWorks } from "@/lib/db";
import { deleteWorkAction } from "@/lib/actions/works";
import DeleteButton from "@/components/admin/DeleteButton";

export const dynamic = "force-dynamic";

export default function AdminWorksPage() {
  const works = listWorks();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">作品（{works.length}）</h1>
        <Link
          href="/admin/works/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white active:bg-neutral-700"
        >
          + 添加作品
        </Link>
      </div>
      {works.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">还没有作品</p>}
      <ul className="flex flex-col gap-2">
        {works.map((work) => (
          <li key={work.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
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
            <div className="ml-[4.25rem] flex shrink-0 flex-wrap gap-x-4 gap-y-2 sm:ml-auto">
              {work.link && <a href={work.link} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-700 underline">查看</a>}
              <Link href={`/admin/works/${work.id}/edit`} className="text-sm text-neutral-700 underline">
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
