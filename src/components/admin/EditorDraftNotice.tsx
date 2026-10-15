"use client";

import type { EditorDraft } from "@/lib/editor-draft";

type DraftState = { offer: EditorDraft | null; savedAt: string | null; error: string; dirty: boolean; changedOnServer: boolean; recover: () => void; discard: () => void };
export default function EditorDraftNotice({ draft }: { draft: DraftState }) {
  return <div className="text-xs leading-6 text-neutral-500" aria-live="polite">
    {draft.offer ? <div className="rounded-lg border border-neutral-200 p-3">
      <p>发现本设备未保存的草稿 · {new Date(draft.offer.savedAt).toLocaleString("zh-CN")}</p>
      {draft.changedOnServer && <p>网站内容已变化，恢复草稿会替换当前编辑框中的内容，请核对后再保存。</p>}
      <div className="mt-1 flex gap-4"><button type="button" onClick={draft.recover} className="underline underline-offset-4">恢复草稿</button><button type="button" onClick={draft.discard}>放弃草稿</button></div>
    </div> : draft.dirty && <p>{draft.savedAt ? "草稿已保存在本浏览器，尚未保存到网站" : "正在保存浏览器草稿…"}</p>}
    {draft.error && <p role="alert" className="text-amber-700">{draft.error}</p>}
  </div>;
}
