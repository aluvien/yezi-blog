import Link from "next/link";
import { listLifeEvents, type LifeEvent } from "@/lib/db";
import { deleteLifeEventAction } from "@/lib/actions/life-events";
import { formatLifeEventDate, normalizeLifeDatePrecision, parseLifeEventImages } from "@/lib/life-events";
import { parsePostTags } from "@/lib/post-tags";
import DeleteButton from "@/components/admin/DeleteButton";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";

export const dynamic = "force-dynamic";

const PRECISION_LABEL: Record<string, string> = { day: "日", month: "月", year: "年" };

function Row({ event }: { event: LifeEvent }) {
  const images = parseLifeEventImages(event.images);
  const tags = parsePostTags(event.tags);
  return (
    <li className="admin-card admin-content-card rounded-2xl bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[15px] font-semibold tabular-nums text-neutral-900">{formatLifeEventDate(event.occurred_at, normalizeLifeDatePrecision(event.date_precision))}</span>
            <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500">精确到{PRECISION_LABEL[event.date_precision] ?? "日"}</span>
            {event.location && <span className="text-[12px] text-neutral-400">· {event.location}</span>}
          </div>
          <Link href={`/admin/life/milestones/${event.id}/edit`} className="mt-1 block text-base font-medium text-neutral-800 transition-colors hover:text-accent">
            {event.title || "（无标题）"}
          </Link>
          {event.content && <p className="mt-1 line-clamp-2 text-[13px] text-neutral-500">{event.content}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-neutral-400">
            {tags.map((tag) => <span key={tag} className="rounded-full bg-neutral-100 px-2 py-0.5">#{tag}</span>)}
            {images.length > 0 && <span className="rounded-full bg-neutral-100 px-2 py-0.5">{images.length} 图</span>}
            {event.source_type === "moment" ? (
              event.source_moment_id
                ? <Link href={`/moments#moment-${event.source_moment_id}`} target="_blank" className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">来自絮语 ↗</Link>
                : <span className="rounded-full bg-neutral-100 px-2 py-0.5">来源絮语已删除</span>
            ) : <span className="rounded-full bg-neutral-100 px-2 py-0.5">手动</span>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
          <Link href={`/admin/life/milestones/${event.id}/edit`} className="admin-action-link admin-action-link-primary text-sm text-neutral-700 hover:text-neutral-950">编辑</Link>
          <DeleteButton action={deleteLifeEventAction.bind(null, event.id)} confirmText="确定删除这个生活节点？来源絮语不会被删除。" />
        </div>
      </div>
    </li>
  );
}

export default function AdminMilestonesPage() {
  const events = listLifeEvents();
  return (
    <div className="flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader
        eyebrow="LIFE · MILESTONES"
        title={`生活节点（${events.length}）`}
        description="对经历整理后的时间索引，按事情实际发生的时间倒序。可从絮语提取，也可手动添加。"
        actions={(
          <div className="flex gap-2">
            <Link href="/admin/life/milestones/extract" className="admin-button rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">从絮语提取</Link>
            <Link href="/admin/life/milestones/new" className="admin-button admin-button-primary rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white active:bg-neutral-700">+ 添加生活节点</Link>
          </div>
        )}
      />
      {events.length === 0 && <p className="py-10 text-center text-sm text-neutral-400">还没有生活节点，点击“添加生活节点”或“从絮语提取”开始。</p>}
      <ul className="flex flex-col gap-2">
        {events.map((event) => <Row key={event.id} event={event} />)}
      </ul>
    </div>
  );
}
