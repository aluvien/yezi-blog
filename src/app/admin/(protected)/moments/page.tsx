import Link from "next/link";
import { getContentMetricsBulk, listMoments, parseMomentImages } from "@/lib/db";
import { deleteMomentAction } from "@/lib/actions/moments";
import { formatDate } from "@/lib/format";
import DeleteButton from "@/components/admin/DeleteButton";

export const dynamic = "force-dynamic";

export default function AdminMomentsPage() {
  const moments = listMoments();
  const metrics = getContentMetricsBulk("moment", moments.map((moment) => moment.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">想法（{moments.length}）</h1>
        <Link
          href="/admin/moments/new"
          className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white active:bg-neutral-700"
        >
          + 发想法
        </Link>
      </div>
      <p className="text-xs leading-5 text-neutral-400">浏览数在访客实际看到想法时统计，同一访客对同一条内容 30 天内只计一次；总浏览数也会汇总到仪表盘。</p>
      {moments.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">还没有想法</p>}
      <ul className="flex flex-col gap-2">
        {moments.map((moment) => {
          const images = parseMomentImages(moment);
          return (
            <li key={moment.id} className="rounded-2xl bg-white p-4 shadow-sm sm:p-5">
              <Link
                href={`/admin/moments/${moment.id}/edit`}
                className="block whitespace-pre-wrap text-base transition-colors hover:text-accent"
                aria-label="编辑这条想法"
              >
                {moment.content}
              </Link>
              {images.length > 0 && (
                <div className="mt-2 flex gap-2 overflow-x-auto">
                  {images.map((src, index) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={`${src}-${index}`} src={src} alt="" className="h-16 w-16 shrink-0 rounded-lg border border-neutral-200 object-cover" />
                  ))}
                </div>
              )}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-xs text-neutral-400">
                  {formatDate(moment.created_at)}
                  <span className="mx-2">·</span>
                  浏览 {metrics.get(moment.id)?.views ?? 0}
                  <span className="mx-2">·</span>
                  点赞 {metrics.get(moment.id)?.likes ?? 0}
                </span>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <Link href={`/moments#moment-${moment.id}`} target="_blank" className="text-sm text-blue-700 hover:text-blue-900">查看</Link>
                  <Link href={`/admin/moments/${moment.id}/edit`} className="text-sm text-neutral-700 hover:text-neutral-950">编辑</Link>
                  <DeleteButton action={deleteMomentAction.bind(null, moment.id)} />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
