import type { Moment } from "@/lib/db";
import { parseMomentImages } from "@/lib/db";
import { formatRelativeTime } from "@/lib/format";
import { MomentCommentToggle } from "@/components/site/MomentCommentToggle";

function MomentImages({ images }: { images: string[] }) {
  if (images.length === 0) return null;
  // 1 张大图，2/4 张两列，其余三列（九宫格）
  const cols = images.length === 1 ? "grid-cols-1" : images.length === 2 || images.length === 4 ? "grid-cols-2" : "grid-cols-3";
  return (
    <div className={`mt-2 grid gap-1.5 ${cols} ${images.length === 1 ? "max-w-[70%]" : ""}`}>
      {images.slice(0, 9).map((src, i) => (
        // 图片为后台上传的本地路径，尺寸不固定，用原生 img
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={i}
          src={src}
          alt=""
          loading="lazy"
          className="aspect-square w-full rounded-lg object-cover"
        />
      ))}
    </div>
  );
}

/**
 * 想法条目（朋友圈样式）。
 * 评论区由父级传入 children，避免在不需要评论区的列表场景重复加载。
 */
export function MomentEntry({
  moment,
  commentCount,
  children,
  compact = false,
}: {
  moment: Moment;
  commentCount: number;
  children?: React.ReactNode;
  compact?: boolean;
}) {
  const images = parseMomentImages(moment);
  return (
    <article id={`moment-${moment.id}`} className="min-w-0">
      {compact && <div className="mb-2"><span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-muted">想法</span></div>}
      <p className={`${compact ? "line-clamp-3" : ""} whitespace-pre-wrap text-[15px] leading-7 text-foreground`}>
        {moment.content}
      </p>
      {!compact && <MomentImages images={images} />}
      {children ? (
        <MomentCommentToggle targetId={moment.id} time={formatRelativeTime(moment.created_at)} count={commentCount}>
          {children}
        </MomentCommentToggle>
      ) : (
        <div className="mt-2 flex items-center gap-x-4 text-[13px] text-muted">
          <span>{formatRelativeTime(moment.created_at)}</span>
          {commentCount > 0 && <span>{commentCount} 条评论</span>}
        </div>
      )}
    </article>
  );
}
