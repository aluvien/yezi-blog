"use client";

import { useEffect, useId, useRef, useState } from "react";
import { momentImageCropStyle, type MomentImageCrop } from "@/lib/moment-image-crops";

export function MomentThumbnailDialog({ src, crop, single, onClose }: {
  src: string; crop?: MomentImageCrop; single: boolean; onClose: (crop?: MomentImageCrop | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [value, setValue] = useState<MomentImageCrop>(() => crop ?? { x: 0.5, y: 0.5, zoom: 1 });
  const [originalRatio, setOriginalRatio] = useState(crop?.originalAspectRatio);
  const [reset, setReset] = useState(false);
  const [ratioInput, setRatioInput] = useState(crop?.aspectRatio === undefined ? "" : String(crop.aspectRatio));
  const ratioValid = ratioInput === "" || (Number.isFinite(Number(ratioInput)) && Number(ratioInput) >= 0.05 && Number(ratioInput) <= 20);
  const ratio = value.aspectRatio ?? (single ? originalRatio : undefined) ?? 1;
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  function change(next: Partial<MomentImageCrop>) {
    setReset(false);
    setValue(current => ({ ...current, ...next }));
    if ("aspectRatio" in next) setRatioInput(next.aspectRatio === undefined ? "" : String(next.aspectRatio));
  }
  return <dialog ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto max-h-[90dvh] w-[min(92vw,480px)] overflow-y-auto rounded-xl border p-5 shadow-xl backdrop:bg-black/50"
    style={{ background: "var(--bg, white)", color: "var(--text, #171717)", borderColor: "var(--border, #ddd)" }}>
    <h2 id={title} className="mb-2 text-lg font-semibold">编辑缩略图</h2>
    <p className="mb-4 text-sm opacity-70">调整列表中的展示范围，原图保持完整。应用后需保存絮语。</p>
    <div className="mb-4 flex min-h-40 items-center justify-center rounded-lg bg-black/5 p-3">
      <div className="relative overflow-hidden rounded-md" style={{ aspectRatio: String(ratio), width: `min(100%, ${280 * ratio}px)` }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="缩略图预览" className="absolute inset-0 h-full w-full object-cover" style={{ ...momentImageCropStyle(value), width: "100%", height: "100%", objectFit: "cover" }}
          onLoad={event => { const image = event.currentTarget; if (image.naturalHeight) setOriginalRatio(image.naturalWidth / image.naturalHeight); }} />
      </div>
    </div>
    <div className="space-y-4">
      <label className="block text-sm">显示比例
        <select className="mt-1 w-full rounded-md border bg-transparent p-2" value={value.aspectRatio === undefined ? "auto" : String(value.aspectRatio)}
          onChange={event => change({ aspectRatio: event.target.value === "auto" ? undefined : Number(event.target.value) })}>
          <option value="auto">跟随网站布局</option>
          {[1, 4 / 3, 3 / 4, 16 / 9].map((number, index) => <option key={number} value={number}>{["正方形 1:1", "横图 4:3", "竖图 3:4", "宽屏 16:9"][index]}</option>)}
          {originalRatio && originalRatio >= 0.05 && originalRatio <= 20 && ![1, 4 / 3, 3 / 4, 16 / 9].includes(originalRatio) && <option value={originalRatio}>原图比例</option>}
          {value.aspectRatio !== undefined && value.aspectRatio !== originalRatio && ![1, 4 / 3, 3 / 4, 16 / 9].includes(value.aspectRatio) && <option value={value.aspectRatio}>自定义比例</option>}
        </select>
      </label>
      <label className="block text-sm">自定义宽高比（宽 ÷ 高）
        <input type="number" min="0.05" max="20" step="any" aria-invalid={!ratioValid} className="mt-1 w-full rounded-md border bg-transparent p-2" value={ratioInput} placeholder="例如 1.5；留空跟随网站"
          onChange={event => { const raw = event.target.value; const number = Number(raw); setRatioInput(raw); setReset(false); if (!raw) setValue(current => ({ ...current, aspectRatio: undefined })); else if (Number.isFinite(number) && number >= 0.05 && number <= 20) setValue(current => ({ ...current, aspectRatio: number })); }} />
        {!ratioValid && <span className="text-red-600">宽高比需在 0.05 到 20 之间</span>}
      </label>
      {([['x', '左右位置', 0, 1, 0.01], ['y', '上下位置', 0, 1, 0.01], ['zoom', '缩放', 1, 4, 0.01]] as const).map(([key, label, min, max, step]) =>
        <label key={key} className="block text-sm">{label} <span className="float-right opacity-60">{key === 'zoom' ? `${value[key].toFixed(2)} 倍` : `${Math.round(value[key] * 100)}%`}</span>
          <input type="range" className="mt-2 block w-full" min={min} max={max} step={step} value={value[key]} onChange={event => change({ [key]: Number(event.target.value) })} />
        </label>)}
    </div>
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3 text-sm">
      <button type="button" className="mr-auto underline" onClick={() => { setValue({ x: 0.5, y: 0.5, zoom: 1 }); setRatioInput(""); setReset(true); }}>恢复默认</button>
      <button type="button" className="rounded-md border px-3 py-2" onClick={() => onClose()}>取消</button>
      <button type="button" disabled={!ratioValid} className="admin-button admin-button-primary disabled:opacity-50" onClick={() => onClose(reset ? null : { ...value, ...(originalRatio && originalRatio >= 0.05 && originalRatio <= 20 ? { originalAspectRatio: originalRatio } : {}) })}>应用</button>
    </div>
  </dialog>;
}
