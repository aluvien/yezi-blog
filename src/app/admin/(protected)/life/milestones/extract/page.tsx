import { listMoments, lifeEventMomentIdsWithNode, getSiteSettings } from "@/lib/db";
import { parseMomentImages } from "@/lib/moments";
import { parsePostTags } from "@/lib/post-tags";
import AdminPageHeader from "@/components/admin/AdminPageHeader";
import LifeAdminTabs from "@/components/admin/LifeAdminTabs";
import MomentPicker, { type MomentPickerItem } from "@/components/admin/MomentPicker";
import { getLifeEventBySourceMoment } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function LifeExtractPickerPage() {
  const moments = listMoments();
  const extracted = lifeEventMomentIdsWithNode(moments.map((moment) => moment.id));
  const items: MomentPickerItem[] = moments.map((moment) => ({
    id: moment.id,
    created_at: moment.created_at,
    excerpt: moment.content.replace(/\s+/g, " ").trim().slice(0, 80) || "（图片）",
    images: parseMomentImages(moment).slice(0, 3),
    tags: parsePostTags(moment.tags).slice(0, 4),
    extracted: extracted.has(moment.id),
    nodeId: getLifeEventBySourceMoment(moment.id)?.id ?? null,
  }));
  void getSiteSettings;

  return (
    <div className="flex flex-col gap-4">
      <LifeAdminTabs />
      <AdminPageHeader
        eyebrow="LIFE · EXTRACT"
        title="从絮语提取生活节点"
        description="选择一条当时的絮语，进入整理界面补充标题与时间后保存。提取是复制 + 整理，原絮语完全保留。"
      />
      <MomentPicker items={items} />
    </div>
  );
}
