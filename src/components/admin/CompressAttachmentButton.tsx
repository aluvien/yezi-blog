"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/actions/posts";
import type { CompressionProfile } from "@/lib/actions/attachments";

const PROFILES: Array<{ value: CompressionProfile; label: string }> = [
  { value: "balanced", label: "标准" },
  { value: "quality", label: "高质量" },
  { value: "small", label: "小体积" },
];

export default function CompressAttachmentButton({
  action,
}: {
  action: (profile: CompressionProfile) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const profileId = useId();
  const [profile, setProfile] = useState<CompressionProfile>("balanced");
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-1">
      <label className="sr-only" htmlFor={profileId}>压缩级别</label>
      <select
        id={profileId}
        value={profile}
        disabled={pending}
        onChange={(event) => setProfile(event.target.value as CompressionProfile)}
        className="rounded-md border border-neutral-200 bg-white px-1.5 py-1 text-xs text-neutral-600 disabled:opacity-50"
      >
        {PROFILES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("压缩会在原文件上替换图片，但保留原链接；是否继续？")) return;
          startTransition(async () => {
            const result = await action(profile);
            if (!result.ok) window.alert(result.error);
            else if (result.message) window.alert(result.message);
            router.refresh();
          });
        }}
        className="text-sm text-amber-700 disabled:opacity-50"
      >
        {pending ? "压缩中…" : "压缩"}
      </button>
    </span>
  );
}
