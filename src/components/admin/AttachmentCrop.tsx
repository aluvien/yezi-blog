"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ADMIN_CSRF_HEADER } from "@/lib/client-security";
import { ReactCrop as _ReactCrop, type Crop, type PixelCrop } from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";

// react-image-crop 的类型与 React 19 推断不兼容，这里断言为可用的组件类型
const ReactCrop = _ReactCrop as unknown as React.ComponentType<{
  crop?: Crop;
  onChange: (crop: Crop, percentCrop: Crop) => void;
  onComplete?: (crop: PixelCrop, percentCrop: Crop) => void;
  children?: React.ReactNode;
}>;

/** 自由比例裁切:拖拽选区 -> 调 crop API -> 跳转到新附件详情。 */
export function AttachmentCrop({ attachmentId, src }: { attachmentId: number; src: string }) {
  const router = useRouter();
  const [crop, setCrop] = useState<Crop | undefined>(undefined);
  const [completedCrop, setCompletedCrop] = useState<PixelCrop | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  async function doCrop() {
    const image = imgRef.current;
    if (!completedCrop || completedCrop.width <= 0 || completedCrop.height <= 0 || !image || image.clientWidth <= 0 || image.clientHeight <= 0) {
      window.alert("请先在图片上拖出一个裁切区域");
      return;
    }
    const scaleX = image.naturalWidth / image.clientWidth;
    const scaleY = image.naturalHeight / image.clientHeight;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/attachments/${attachmentId}/crop`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...ADMIN_CSRF_HEADER },
        body: JSON.stringify({
          x: Math.round(completedCrop.x * scaleX),
          y: Math.round(completedCrop.y * scaleY),
          width: Math.round(completedCrop.width * scaleX),
          height: Math.round(completedCrop.height * scaleY),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; attachment?: { id: number } };
      if (!res.ok || !data.attachment) throw new Error(data.error || "裁切失败");
      router.push(`/admin/attachments/${data.attachment.id}`);
      router.refresh();
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "裁切失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ReactCrop crop={crop} onChange={(c) => setCrop(c)} onComplete={(c) => setCompletedCrop(c)}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img ref={imgRef} src={src} alt="裁切预览" style={{ maxHeight: 400 }} />
      </ReactCrop>
      <button
        type="button"
        onClick={doCrop}
        disabled={busy}
        className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
      >
        {busy ? "裁切中…" : "按选区裁切并另存为新附件"}
      </button>
    </div>
  );
}
