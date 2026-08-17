"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSiteSettingsAction } from "@/lib/actions/settings";
import { deleteAttachmentAction } from "@/lib/actions/attachments";
import type { Attachment } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";
import { MusicInsertDialog } from "./MusicInsertDialog";
import { VideoInsertDialog } from "./VideoInsertDialog";
import { MarkdownToolbar, STANDARD_MARKDOWN_TOOLS, type MarkdownTool } from "./MarkdownToolbar";

type TextRange = { start: number; end: number };

function escapeMarkdownLabel(value: string): string {
  return value.replace(/[\[\]\n\r]/g, "").trim();
}

function escapeMarkdownUrl(value: string): string {
  return value.trim().replace(/\s/g, "%20").replace(/\)/g, "%29");
}

function isSafeMarkdownUrl(value: string): boolean {
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function AboutPageForm({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [content, setContent] = useState(initialValue);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [markdownDialog, setMarkdownDialog] = useState<"link" | "image" | null>(null);
  const [musicDialog, setMusicDialog] = useState(false);
  const [videoDialog, setVideoDialog] = useState(false);
  const [dialogText, setDialogText] = useState("");
  const [dialogUrl, setDialogUrl] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [dialogUploading, setDialogUploading] = useState(false);
  const [dialogAttachment, setDialogAttachment] = useState<Attachment | null>(null);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const markdownImageInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<TextRange | null>(null);
  const dialogRangeRef = useRef<TextRange | null>(null);

  function rememberSelection(textarea = textareaRef.current): void {
    if (!textarea) return;
    selectionRef.current = { start: textarea.selectionStart, end: textarea.selectionEnd };
  }

  function getEditingRange(): TextRange {
    const textarea = textareaRef.current;
    if (textarea && document.activeElement === textarea) rememberSelection(textarea);
    const saved = selectionRef.current;
    if (!saved) return { start: content.length, end: content.length };
    return {
      start: Math.max(0, Math.min(saved.start, content.length)),
      end: Math.max(0, Math.min(saved.end, content.length)),
    };
  }

  function replaceTextAtRange(text: string, range: TextRange, selectedRange?: TextRange): void {
    const nextContent = `${content.slice(0, range.start)}${text}${content.slice(range.end)}`;
    setContent(nextContent);
    const nextSelection = selectedRange ?? { start: range.start + text.length, end: range.start + text.length };
    selectionRef.current = nextSelection;
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(nextSelection.start, nextSelection.end);
    });
  }

  function insertMarkdown(before: string, after: string, placeholder: string): void {
    const range = getEditingRange();
    const value = content.slice(range.start, range.end) || placeholder;
    const selectionStart = range.start + before.length;
    replaceTextAtRange(`${before}${value}${after}`, range, { start: selectionStart, end: selectionStart + value.length });
  }

  function insertLinePrefix(prefix: string, placeholder: string): void {
    const range = getEditingRange();
    const lineStart = content.lastIndexOf("\n", Math.max(0, range.start - 1)) + 1;
    const nextLineBreak = content.indexOf("\n", range.end);
    const lineEnd = nextLineBreak === -1 ? content.length : nextLineBreak;
    const lineRange = { start: lineStart, end: lineEnd };
    const selected = content.slice(lineRange.start, lineRange.end);
    const value = selected || placeholder;
    const replacement = value.split("\n").map((line) => `${prefix}${line}`).join("\n");
    const selectedRange = selected
      ? { start: lineRange.start, end: lineRange.start + replacement.length }
      : { start: lineRange.start + prefix.length, end: lineRange.start + prefix.length + value.length };
    replaceTextAtRange(replacement, lineRange, selectedRange);
  }

  function insertMusicBlock(spec: string): void {
    const range = dialogRangeRef.current ?? getEditingRange();
    dialogRangeRef.current = null;
    replaceTextAtRange(`\n\`\`\`music\n${spec}\n\`\`\`\n`, range);
  }

  function insertVideoBlock(spec: string): void {
    const range = dialogRangeRef.current ?? getEditingRange();
    dialogRangeRef.current = null;
    replaceTextAtRange(`\n\`\`\`video\n${spec}\n\`\`\`\n`, range);
  }

  function openMarkdownDialog(kind: "link" | "image"): void {
    const range = getEditingRange();
    dialogRangeRef.current = range;
    setMarkdownDialog(kind);
    setDialogText(content.slice(range.start, range.end));
    setDialogUrl("");
    setDialogError("");
    setDialogAttachment(null);
  }

  async function discardDialogAttachment(): Promise<void> {
    if (!dialogAttachment) return;
    try {
      await deleteAttachmentAction(dialogAttachment.id);
    } catch {
      // 清理未插入正文的图片失败时，由附件管理页的未引用清理兜底。
    }
  }

  function closeMarkdownDialog(discardAttachment = true): void {
    if (discardAttachment) void discardDialogAttachment();
    setMarkdownDialog(null);
    setDialogError("");
    setDialogAttachment(null);
    dialogRangeRef.current = null;
    if (markdownImageInputRef.current) markdownImageInputRef.current.value = "";
  }

  function runMarkdownTool(tool: MarkdownTool): void {
    if (tool.kind === "link" || tool.kind === "image") {
      openMarkdownDialog(tool.kind);
      return;
    }
    if (tool.kind === "music") {
      dialogRangeRef.current = getEditingRange();
      setMusicDialog(true);
      return;
    }
    if (tool.kind === "video") {
      dialogRangeRef.current = getEditingRange();
      setVideoDialog(true);
      return;
    }
    if (tool.kind === "line-prefix") {
      insertLinePrefix(tool.prefix, tool.placeholder);
      return;
    }
    if (tool.kind === "raw") {
      replaceTextAtRange(tool.text, getEditingRange());
      return;
    }
    if (tool.kind === "wrap") {
      insertMarkdown(tool.before, tool.after, tool.placeholder);
    }
  }

  async function handleMarkdownImageFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setDialogUploading(true);
    setDialogError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("original", "false");
      const response = await fetch("/api/admin/upload", { method: "POST", body: form });
      const data = await response.json().catch(() => ({})) as { attachment?: Attachment; error?: unknown };
      if (!response.ok || !data.attachment) throw new Error(typeof data.error === "string" ? data.error : "图片上传失败");
      setDialogAttachment(data.attachment);
      setDialogUrl(data.attachment.path);
    } catch (reason) {
      setDialogError(reason instanceof Error ? reason.message : "图片上传失败");
    } finally {
      setDialogUploading(false);
      if (markdownImageInputRef.current) markdownImageInputRef.current.value = "";
    }
  }

  function confirmMarkdownDialog(): void {
    const kind = markdownDialog;
    const url = dialogUrl.trim();
    if (!kind || !url) {
      setDialogError(kind === "image" ? "请输入图片网址，或先上传图片。" : "请输入链接网址。");
      return;
    }
    if (!isSafeMarkdownUrl(url)) {
      setDialogError("网址只支持 http、https 或站内路径。");
      return;
    }
    const range = dialogRangeRef.current ?? getEditingRange();
    const text = escapeMarkdownLabel(dialogText) || (kind === "image" ? "图片" : "链接文字");
    const markdown = kind === "image"
      ? `![${text}](${escapeMarkdownUrl(url)})`
      : `[${text}](${escapeMarkdownUrl(url)})`;
    const usedUploadedImage = kind === "image" && dialogAttachment?.path === url;
    replaceTextAtRange(markdown, range);
    closeMarkdownDialog(!usedUploadedImage);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    startTransition(async () => {
      const result = await updateSiteSettingsAction({ about_content: content });
      if (!result.ok) return setError(result.error);
      setMessage("关于页面已保存");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <section className="admin-card rounded-2xl bg-white p-5 shadow-sm sm:p-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <label htmlFor="about-markdown-editor" className="block text-sm font-medium text-neutral-800">关于页内容（Markdown）</label>
          <button type="button" onClick={() => setPreview((value) => !value)} className="rounded-lg border border-neutral-300 px-3 py-1 text-sm text-neutral-600">
            {preview ? "返回编辑" : "预览"}
          </button>
        </div>
        <p className="mb-3 text-xs leading-5 text-neutral-500">支持 Markdown；留空时前台显示默认关于内容。文章引用需要文章专属快照，仅支持在文章编辑器中插入。</p>
        {preview ? (
          <div
            className="prose-neutral min-h-64 w-full rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-3 text-base leading-7 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-bold [&_img]:max-w-full [&_p]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-neutral-800 [&_pre]:p-3 [&_pre]:text-neutral-100 [&_blockquote]:border-l-4 [&_blockquote]:border-neutral-300 [&_blockquote]:pl-3 [&_blockquote]:text-neutral-500 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content || "*（暂无内容）*") }}
          />
        ) : (
          <>
            <MarkdownToolbar tools={STANDARD_MARKDOWN_TOOLS} onBeforeTool={rememberSelection} onTool={runMarkdownTool} />
            <textarea
              ref={textareaRef}
              id="about-markdown-editor"
              value={content}
              onChange={(event) => {
                setContent(event.target.value);
                rememberSelection(event.currentTarget);
              }}
              onSelect={(event) => rememberSelection(event.currentTarget)}
              onClick={(event) => rememberSelection(event.currentTarget)}
              onKeyUp={(event) => rememberSelection(event.currentTarget)}
              onBlur={(event) => rememberSelection(event.currentTarget)}
              rows={20}
              className="min-h-[420px] w-full resize-y rounded-xl border border-neutral-300 px-3 py-3 font-mono text-sm leading-7 outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
              placeholder="写一点关于自己的介绍…"
            />
          </>
        )}
      </section>
      <div className="admin-settings-savebar flex flex-wrap items-center gap-4">
        <button type="submit" disabled={pending} className="admin-button admin-button-primary rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "保存中…" : "保存关于页面"}</button>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-600">{message}</p>}
      </div>
      {markdownDialog && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-900/30 p-4 backdrop-blur-[2px]" onMouseDown={(event) => {
          if (event.target === event.currentTarget) closeMarkdownDialog();
        }}>
          <div role="dialog" aria-modal="true" aria-labelledby="about-markdown-dialog-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-4">
              <h2 id="about-markdown-dialog-title" className="text-base font-semibold text-neutral-900">插入{markdownDialog === "image" ? "图片" : "链接"}</h2>
              <button type="button" aria-label="关闭对话框" onClick={() => closeMarkdownDialog()} className="rounded-full p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">×</button>
            </div>
            <div className="mt-4 flex flex-col gap-3">
              <label className="text-sm text-neutral-700">
                {markdownDialog === "image" ? "替代文字（可选）" : "链接文字"}
                <input value={dialogText} onChange={(event) => setDialogText(event.target.value)} placeholder={markdownDialog === "image" ? "图片说明" : "链接文字"} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" />
              </label>
              <label className="text-sm text-neutral-700">
                {markdownDialog === "image" ? "图片网址" : "链接网址"}
                <input value={dialogUrl} onChange={(event) => { setDialogUrl(event.target.value); setDialogError(""); }} placeholder={markdownDialog === "image" ? "https://example.com/image.jpg 或 /uploads/..." : "https://example.com"} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15" />
              </label>
              {markdownDialog === "image" && (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2.5">
                  <input ref={markdownImageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(event) => void handleMarkdownImageFile(event.target.files?.[0])} />
                  <button type="button" disabled={dialogUploading} onClick={() => markdownImageInputRef.current?.click()} className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 disabled:opacity-50">{dialogUploading ? "上传中…" : "上传图片"}</button>
                  <span className="min-w-0 truncate text-xs text-neutral-500">{dialogAttachment ? `已选择：${dialogAttachment.original_name}` : "也可以直接粘贴图片网址"}</span>
                </div>
              )}
            </div>
            {dialogError && <p className="mt-3 text-sm text-red-600">{dialogError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => closeMarkdownDialog()} className="rounded-lg border border-neutral-300 px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-50">取消</button>
              <button type="button" disabled={dialogUploading} onClick={confirmMarkdownDialog} className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">插入{markdownDialog === "image" ? "图片" : "链接"}</button>
            </div>
          </div>
        </div>
      )}
      {musicDialog && (
        <MusicInsertDialog onClose={(spec) => {
          setMusicDialog(false);
          if (spec) insertMusicBlock(spec);
          else dialogRangeRef.current = null;
        }} />
      )}
      {videoDialog && (
        <VideoInsertDialog onClose={(spec) => {
          setVideoDialog(false);
          if (spec) insertVideoBlock(spec);
          else dialogRangeRef.current = null;
        }} />
      )}
    </form>
  );
}
