"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPostAction, updatePostAction } from "@/lib/actions/posts";
import { deleteAttachmentAction } from "@/lib/actions/attachments";
import type { Attachment, Post } from "@/lib/db";
import type { ArticleReferenceSnapshot } from "@/lib/article-reference";
import { renderMarkdown } from "@/lib/markdown";
import { parsePostTags } from "@/lib/post-tags";
import ImageUpload from "./ImageUpload";
import { MusicInsertDialog } from "./MusicInsertDialog";
import { VideoInsertDialog } from "./VideoInsertDialog";
import { ArticleReferenceDialog } from "./ArticleReferenceDialog";
import { ARTICLE_MARKDOWN_TOOLS, MarkdownToolbar, type MarkdownTool } from "./MarkdownToolbar";
import { ADMIN_CSRF_HEADER } from "@/lib/client-security";

type TextRange = { start: number; end: number };

function escapeMarkdownLabel(value: string) {
  return value.replace(/[\[\]\n\r]/g, "").trim();
}

function escapeMarkdownUrl(value: string) {
  return value.trim().replace(/\s/g, "%20").replace(/\)/g, "%29");
}

function isSafeMarkdownUrl(value: string) {
  if (value.startsWith("/") || value.startsWith("#")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export default function PostForm({ post, initialAttachments = [], initialReferences = [], categories = [], usedTags = [], openReferenceDialog = false }: { post?: Post; initialAttachments?: Attachment[]; initialReferences?: ArticleReferenceSnapshot[]; categories?: string[]; usedTags?: Array<{ tag: string; count: number }>; openReferenceDialog?: boolean }) {
  const router = useRouter();
  const [title, setTitle] = useState(post?.title ?? "");
  const [slug, setSlug] = useState(post?.slug ?? "");
  const [category, setCategory] = useState(post?.category ?? "");
  const [tags, setTags] = useState(parsePostTags(post?.tags).join(", "));
  const [attachments, setAttachments] = useState<Attachment[]>(initialAttachments);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [content, setContent] = useState(post?.content ?? "");
  const [referenceSnapshots, setReferenceSnapshots] = useState<ArticleReferenceSnapshot[]>(initialReferences);
  const [cover, setCover] = useState<string | null>(post?.cover ?? null);
  const [status, setStatus] = useState<"draft" | "published">(post?.status ?? "draft");
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState("");
  const [markdownDialog, setMarkdownDialog] = useState<"link" | "image" | "gallery" | null>(null);
  const [musicDialog, setMusicDialog] = useState(false);
  const [videoDialog, setVideoDialog] = useState(false);
  const [referenceDialog, setReferenceDialog] = useState(openReferenceDialog);
  const [dialogText, setDialogText] = useState("");
  const [dialogUrl, setDialogUrl] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [dialogUploading, setDialogUploading] = useState(false);
  const [dialogAttachments, setDialogAttachments] = useState<Attachment[]>([]);
  const [dialogGalleryColumns, setDialogGalleryColumns] = useState<"auto" | "2" | "3">("auto");
  const [pending, startTransition] = useTransition();
  const [attachmentOriginal, setAttachmentOriginal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const markdownImageInputRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef<TextRange | null>(null);
  const dialogRangeRef = useRef<TextRange | null>(null);
  const selectedTags = parsePostTags(tags);

  function submit() {
    setError("");
    startTransition(async () => {
      const data = { title, slug, content, cover, category, tags, attachmentIds: attachments.map((attachment) => attachment.id), referenceSnapshots, status };
      const r = post ? await updatePostAction(post.id, data) : await createPostAction(data);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push("/admin/posts");
      router.refresh();
    });
  }

  function toggleTag(tag: string) {
    const current = parsePostTags(tags);
    const exists = current.some((t) => t.toLowerCase() === tag.toLowerCase());
    setTags((exists ? current.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...current, tag]).join(", "));
  }

  function rememberSelection(textarea = textareaRef.current) {
    if (!textarea) return;
    selectionRef.current = {
      start: textarea.selectionStart,
      end: textarea.selectionEnd,
    };
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

  function replaceTextAtRange(text: string, range: TextRange, selectedRange?: TextRange) {
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

  function insertMarkdown(before: string, after: string, placeholder: string) {
    const range = getEditingRange();
    const selected = content.slice(range.start, range.end);
    const value = selected || placeholder;
    const replacement = `${before}${value}${after}`;
    const selectionStart = range.start + before.length;
    replaceTextAtRange(replacement, range, { start: selectionStart, end: selectionStart + value.length });
  }

  function insertLinePrefix(prefix: string, placeholder: string) {
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

  function insertTextAtCursor(text: string, forceTail = false) {
    const range = forceTail ? { start: content.length, end: content.length } : getEditingRange();
    replaceTextAtRange(text, range);
  }

  function insertMusicBlock(spec: string) {
    const range = dialogRangeRef.current ?? getEditingRange();
    dialogRangeRef.current = null;
    replaceTextAtRange(`\n\n!music ${spec}\n\n`, range);
  }

  function insertVideoBlock(spec: string) {
    const range = dialogRangeRef.current ?? getEditingRange();
    dialogRangeRef.current = null;
    replaceTextAtRange(`\n\n!video ${spec}\n\n`, range);
  }

  function insertReferenceMarker(marker: string, inline = false) {
    const range = dialogRangeRef.current ?? getEditingRange();
    dialogRangeRef.current = null;
    if (inline) {
      const before = range.start > 0 && !/\s/.test(content.charAt(range.start - 1)) ? " " : "";
      const after = range.end < content.length && !/\s/.test(content.charAt(range.end)) ? " " : "";
      replaceTextAtRange(`${before}${marker}${after}`, range);
      return;
    }
    replaceTextAtRange(`\n${marker}\n`, range);
  }

  function openMarkdownDialog(kind: "link" | "image" | "gallery") {
    const range = getEditingRange();
    dialogRangeRef.current = range;
    setMarkdownDialog(kind);
    setDialogText(content.slice(range.start, range.end));
    setDialogUrl("");
    setDialogError("");
    setDialogAttachments([]);
    setDialogGalleryColumns("auto");
  }

  // 取消或改用别的网址时，删除已上传但未插入正文的图片附件，避免孤儿。
  async function discardDialogAttachments() {
    const orphans = dialogAttachments;
    if (orphans.length === 0) return;
    await Promise.all(orphans.map(async (orphan) => {
      try {
        await deleteAttachmentAction(orphan.id);
      } catch {
        // 附件可能已被删除或已引用，忽略；未引用孤儿也可由附件管理页兜底清理。
      }
    }));
  }

  function closeMarkdownDialog(discardAttachments = true) {
    if (discardAttachments) void discardDialogAttachments();
    setMarkdownDialog(null);
    setDialogError("");
    setDialogAttachments([]);
    setDialogGalleryColumns("auto");
    dialogRangeRef.current = null;
    if (markdownImageInputRef.current) markdownImageInputRef.current.value = "";
  }

  function runMarkdownTool(tool: MarkdownTool) {
    if (tool.kind === "link" || tool.kind === "image" || tool.kind === "gallery") {
      openMarkdownDialog(tool.kind);
    } else if (tool.kind === "music") {
      dialogRangeRef.current = getEditingRange();
      setMusicDialog(true);
    } else if (tool.kind === "video") {
      dialogRangeRef.current = getEditingRange();
      setVideoDialog(true);
    } else if (tool.kind === "reference") {
      dialogRangeRef.current = getEditingRange();
      setReferenceDialog(true);
    } else if (tool.kind === "line-prefix") {
      insertLinePrefix(tool.prefix, tool.placeholder);
    } else if (tool.kind === "raw") {
      insertTextAtCursor(tool.text);
    } else if (tool.kind === "wrap") {
      insertMarkdown(tool.before, tool.after, tool.placeholder);
    }
  }

  function insertAttachment(attachment: Attachment) {
    const range = preview ? { start: content.length, end: content.length } : getEditingRange();
    const selected = content.slice(range.start, range.end).trim();
    const markdown = attachment.mime_type.startsWith("image/")
      ? `![${escapeMarkdownLabel(selected || attachment.original_name)}](${escapeMarkdownUrl(attachment.path)})`
      : `[${escapeMarkdownLabel(selected || attachment.original_name)}](${escapeMarkdownUrl(attachment.path)})`;
    if (preview) {
      setPreview(false);
      window.setTimeout(() => insertTextAtCursor(`${markdown}\n`, true), 60);
    } else {
      replaceTextAtRange(`${markdown}\n`, range);
    }
  }

  async function handleMarkdownImageFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setDialogUploading(true);
    setDialogError("");
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("original", String(attachmentOriginal));
        // 先不绑定文章，只有点击“插入图片”后才将附件加入当前文章。
        const response = await fetch("/api/admin/upload", { method: "POST", headers: ADMIN_CSRF_HEADER, body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.attachment) throw new Error(data.error || `${file.name} 上传失败`);
        const attachment = data.attachment as Attachment;
        setDialogAttachments((current) => [...current, attachment]);
        if (markdownDialog === "image") setDialogUrl(attachment.path);
      }
    } catch (error) {
      setDialogError(error instanceof Error ? error.message : "图片上传失败");
    } finally {
      setDialogUploading(false);
      if (markdownImageInputRef.current) markdownImageInputRef.current.value = "";
    }
  }

  function confirmMarkdownDialog() {
    if (markdownDialog === "gallery") {
      const directUrls = dialogUrl
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean);
      const invalidUrl = directUrls.find((value) => !isSafeMarkdownUrl(value));
      if (invalidUrl) {
        setDialogError(`图片网址无效：${invalidUrl}`);
        return;
      }
      const entries = [
        ...dialogAttachments.map((attachment) => ({ label: attachment.original_name, url: attachment.path })),
        ...directUrls.map((url, index) => ({ label: `图片 ${index + 1}`, url })),
      ];
      const uniqueEntries = entries.filter((entry, index, all) => all.findIndex((item) => item.url === entry.url) === index);
      if (uniqueEntries.length === 0) {
        setDialogError("请至少上传一张图片，或每行填写一个图片网址。");
        return;
      }
      const columns = dialogGalleryColumns === "auto" ? "" : ` cols-${dialogGalleryColumns}`;
      const markdown = `\n\n!gallery${columns}\n${uniqueEntries.map((entry) => `- ![${escapeMarkdownLabel(entry.label) || "图片"}](${escapeMarkdownUrl(entry.url)})`).join("\n")}\n!endgallery\n\n`;
      if (dialogAttachments.length > 0) {
        setAttachments((current) => {
          const next = [...current];
          for (const attachment of dialogAttachments) {
            if (!next.some((item) => item.id === attachment.id)) next.unshift(attachment);
          }
          return next;
        });
      }
      const range = dialogRangeRef.current ?? getEditingRange();
      replaceTextAtRange(markdown, range);
      closeMarkdownDialog(false);
      return;
    }

    const url = dialogUrl.trim();
    if (!url) {
      setDialogError(markdownDialog === "image" ? "请输入图片网址，或先上传图片。" : "请输入链接网址。");
      return;
    }
    if (!isSafeMarkdownUrl(url)) {
      setDialogError("网址只支持 http、https 或站内路径。");
      return;
    }
    const range = dialogRangeRef.current ?? getEditingRange();
    const text = escapeMarkdownLabel(dialogText) || (markdownDialog === "image" ? "图片" : "链接文字");
    const markdown = markdownDialog === "image"
      ? `![${text}](${escapeMarkdownUrl(url)})`
      : `[${text}](${escapeMarkdownUrl(url)})`;
    const usedAttachment = markdownDialog === "image"
      ? dialogAttachments.find((attachment) => url === attachment.path)
      : undefined;
    if (usedAttachment) {
      setAttachments((current) => current.some((item) => item.id === usedAttachment.id) ? current : [usedAttachment, ...current]);
    }
    replaceTextAtRange(markdown, range);
    // 已纳入文章附件则保留；否则关闭时丢弃未使用的上传附件。
    closeMarkdownDialog(!usedAttachment);
  }

  async function handleAttachmentFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploadingAttachment(true);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        if (post?.id) form.append("post_id", String(post.id));
        form.append("original", String(attachmentOriginal));
        const response = await fetch("/api/admin/upload", { method: "POST", headers: ADMIN_CSRF_HEADER, body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.attachment) throw new Error(data.error || "附件上传失败");
        setAttachments((current) => [data.attachment as Attachment, ...current]);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "附件上传失败");
    } finally {
      setUploadingAttachment(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = "";
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function addUploadedAttachment(attachment: Attachment) {
    setAttachments((current) => current.some((item) => item.id === attachment.id) ? current : [attachment, ...current]);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="flex min-w-0 flex-col gap-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">标题</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
            placeholder="文章标题"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-neutral-700">Slug（留空自动生成）</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-base"
            placeholder="my-first-post"
          />
        </div>
        <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-sm font-medium text-neutral-700">正文（Markdown）</label>
          <button
            type="button"
            onClick={() => setPreview((v) => !v)}
            className="rounded-lg border border-neutral-300 px-3 py-1 text-sm text-neutral-600"
          >
            {preview ? "返回编辑" : "预览"}
          </button>
        </div>
        {preview ? (
          <div
            className="prose-neutral min-h-64 w-full rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-base leading-7 [&_h1]:mt-4 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-bold [&_img]:max-w-full [&_p]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:bg-neutral-800 [&_pre]:p-3 [&_pre]:text-neutral-100 [&_blockquote]:border-l-4 [&_blockquote]:border-neutral-300 [&_blockquote]:pl-3 [&_blockquote]:text-neutral-500 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content || "*（暂无内容）*", referenceSnapshots) }}
          />
        ) : (
          <>
            <MarkdownToolbar tools={ARTICLE_MARKDOWN_TOOLS} onBeforeTool={rememberSelection} onTool={runMarkdownTool} />
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                rememberSelection(e.currentTarget);
              }}
              onSelect={(e) => rememberSelection(e.currentTarget)}
              onClick={(e) => rememberSelection(e.currentTarget)}
              onKeyUp={(e) => rememberSelection(e.currentTarget)}
              onBlur={(e) => rememberSelection(e.currentTarget)}
              rows={20}
              className="min-h-[420px] w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 font-mono text-sm leading-6"
              placeholder="# 开始写作…"
            />
          </>
        )}
        </div>
      </div>
      <aside className="flex flex-col gap-3 lg:sticky lg:top-20">
        <div className="px-1 pb-1">
          <p className="text-[11px] font-medium tracking-[0.14em] text-accent">文章设置</p>
          <p className="mt-1 text-xs text-neutral-400">附件、状态和索引信息</p>
        </div>
        <section className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-neutral-800">附件</h2>
              <p className="mt-1 text-xs text-neutral-400">点击“插入”写入光标处</p>
            </div>
            <button
              type="button"
              disabled={uploadingAttachment}
              onClick={() => attachmentInputRef.current?.click()}
              className="rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-700 disabled:opacity-50"
            >
              {uploadingAttachment ? "上传中…" : "+ 上传附件"}
            </button>
          </div>
          <input
            ref={attachmentInputRef}
            type="file"
            multiple
            accept="image/*,.pdf,.txt,.md,.zip,.doc,.docx"
            className="hidden"
            onChange={(event) => handleAttachmentFiles(event.target.files)}
          />
          <label className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
            <input type="checkbox" checked={attachmentOriginal} onChange={(e) => setAttachmentOriginal(e.target.checked)} className="h-3.5 w-3.5 accent-neutral-700" />
            保留原图(不压缩)
          </label>
          {attachments.length > 0 && (
            <ul className="mt-3 flex flex-col gap-2">
              {attachments.map((attachment) => {
                const referencedInContent = content.includes(attachment.path);
                const isCover = cover === attachment.path;
                const referenced = referencedInContent || isCover;
                return (
                  <li key={attachment.id} className="rounded-lg border border-neutral-200 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      {attachment.mime_type.startsWith("image/") && (
                        // 上传路径由后台动态生成，使用原生 img 避免 next/image 远程配置与缓存问题。
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={attachment.path} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                      )}
                      <p className="min-w-0 flex-1 truncate text-xs text-neutral-700">{attachment.original_name}</p>
                      <span className={`shrink-0 text-[10px] ${referenced ? "text-green-600" : "text-amber-600"}`}>
                        {isCover && referencedInContent ? "正文+封面" : isCover ? "封面" : referencedInContent ? "正文已引用" : "未引用"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-neutral-400">
                      <span>{formatBytes(attachment.size)}</span>
                      <div className="flex items-center gap-3">
                        {attachment.mime_type.startsWith("image/") && (
                          isCover ? (
                            <button type="button" onClick={() => setCover(null)} className="text-amber-700 underline">取消封面</button>
                          ) : (
                            <button type="button" onClick={() => setCover(attachment.path)} className="text-blue-700 underline">设为封面</button>
                          )
                        )}
                        <button type="button" onClick={() => insertAttachment(attachment)} className="text-blue-700 underline">插入</button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <label htmlFor="post-status" className="mb-1 block text-sm font-medium text-neutral-700">发布状态</label>
          <select
            id="post-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as "draft" | "published")}
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-base"
          >
            <option value="draft">草稿——仅后台可见</option>
            <option value="published">已发布——前台公开</option>
          </select>
        </section>

        <section className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <ImageUpload value={cover} onChange={setCover} onAttachmentUploaded={addUploadedAttachment} label="封面图（可空）" />
          <p className="mt-2 text-xs text-neutral-400">也可以在上方图片附件中点击“设为封面”。封面只用于首页和分享图，正文中不会自动重复显示。</p>
        </section>

        <section className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-neutral-700">分类</p>
          <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label="选择分类">
            <label className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${category === "" ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500"}`}>
              <input type="radio" name="post-category" value="" checked={category === ""} onChange={() => setCategory("")} className="h-3.5 w-3.5 accent-current" />
              未分类
            </label>
            {categories.map((c) => (
              <label key={c} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${category === c ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500"}`}>
                <input type="radio" name="post-category" value={c} checked={category === c} onChange={() => setCategory(c)} className="h-3.5 w-3.5 accent-current" />
                {c}
              </label>
            ))}
          </div>
          <input value={category} onChange={(e) => setCategory(e.target.value)} className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" placeholder="也可直接填写新分类" />
          <p className="mt-1 text-xs text-neutral-400">单选一个分类；分类选项来自分类管理，也可以直接填写新分类。</p>
        </section>

        <section className="rounded-2xl border border-neutral-200/80 bg-white p-4 shadow-sm">
          <p className="text-sm font-medium text-neutral-700">标签</p>
          {usedTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="选择标签">
              {usedTags.slice(0, 20).map(({ tag, count }) => (
                <label key={tag} className={`inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${selectedTags.some((selected) => selected.toLowerCase() === tag.toLowerCase()) ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 bg-white text-neutral-600 hover:border-neutral-500"}`}>
                  <input type="checkbox" checked={selectedTags.some((selected) => selected.toLowerCase() === tag.toLowerCase())} onChange={() => toggleTag(tag)} className="h-3.5 w-3.5 rounded accent-current" />
                  #{tag}<sup>{count}</sup>
                </label>
              ))}
            </div>
          )}
          <input value={tags} onChange={(e) => setTags(e.target.value)} className="mt-3 w-full rounded-lg border border-neutral-300 px-3 py-2 text-base" placeholder="也可直接填写，逗号分隔" />
          <p className="mt-1 text-xs text-neutral-400">用逗号分隔，最多保存 12 个标签。</p>
        </section>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="button"
          disabled={pending}
          onClick={submit}
          className="rounded-lg bg-neutral-900 py-3 text-base font-medium text-white active:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? "保存中…" : post ? "保存修改" : status === "published" ? "发布文章" : "保存草稿"}
        </button>
      </aside>
      {markdownDialog && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-neutral-900/30 p-4 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeMarkdownDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="markdown-dialog-title"
            className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl"
          >
            <div className="flex items-center justify-between gap-4">
              <h2 id="markdown-dialog-title" className="text-base font-semibold text-neutral-900">
                {markdownDialog === "image" ? "插入图片" : markdownDialog === "gallery" ? "插入图片合集" : "插入链接"}
              </h2>
              <button
                type="button"
                aria-label="关闭对话框"
                onClick={() => closeMarkdownDialog()}
                className="rounded-full p-1 text-xl leading-none text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                ×
              </button>
            </div>

            <div className="mt-4 flex flex-col gap-3">
              {markdownDialog !== "gallery" && (
                <label className="text-sm text-neutral-700">
                  {markdownDialog === "image" ? "替代文字（可选）" : "链接文字"}
                  <input
                    value={dialogText}
                    onChange={(event) => setDialogText(event.target.value)}
                    placeholder={markdownDialog === "image" ? "图片说明" : "链接文字"}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                  />
                </label>
              )}

              {markdownDialog === "gallery" && (
                <label className="text-sm text-neutral-700">
                  图片列数
                  <select
                    value={dialogGalleryColumns}
                    onChange={(event) => setDialogGalleryColumns(event.target.value as "auto" | "2" | "3")}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                  >
                    <option value="auto">自适应</option>
                    <option value="2">固定 2 列</option>
                    <option value="3">固定 3 列</option>
                  </select>
                </label>
              )}

              <label className="text-sm text-neutral-700">
                {markdownDialog === "image" ? "图片网址" : markdownDialog === "gallery" ? "图片网址（可选，每行一个）" : "链接网址"}
                {markdownDialog === "gallery" ? (
                  <textarea
                    value={dialogUrl}
                    onChange={(event) => {
                      setDialogUrl(event.target.value);
                      setDialogError("");
                    }}
                    rows={3}
                    placeholder="https://example.com/one.jpg\nhttps://example.com/two.jpg"
                    className="mt-1.5 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                  />
                ) : (
                  <input
                    value={dialogUrl}
                    onChange={(event) => {
                      setDialogUrl(event.target.value);
                      setDialogError("");
                    }}
                    placeholder={markdownDialog === "image" ? "https://example.com/image.jpg 或 /uploads/..." : "https://example.com"}
                    className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/15"
                  />
                )}
              </label>

              {(markdownDialog === "image" || markdownDialog === "gallery") && (
                <div className="flex items-center gap-3 rounded-lg border border-dashed border-neutral-300 bg-neutral-50 px-3 py-2.5">
                  <input
                    ref={markdownImageInputRef}
                    type="file"
                    multiple={markdownDialog === "gallery"}
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={(event) => void handleMarkdownImageFiles(event.target.files)}
                  />
                  <button
                    type="button"
                    disabled={dialogUploading}
                    onClick={() => markdownImageInputRef.current?.click()}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 disabled:opacity-50"
                  >
                    {dialogUploading ? "上传中…" : "上传图片"}
                  </button>
                  <span className="min-w-0 truncate text-xs text-neutral-500">
                    {dialogAttachments.length > 0
                      ? markdownDialog === "gallery" ? `已选择 ${dialogAttachments.length} 张图片` : `已选择：${dialogAttachments[0].original_name}`
                      : markdownDialog === "gallery" ? "可一次选择多张图片" : "也可以直接粘贴图片网址"}
                  </span>
                </div>
              )}
            </div>

            {dialogError && <p className="mt-3 text-sm text-red-600">{dialogError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => closeMarkdownDialog()}
                className="rounded-lg border border-neutral-300 px-3.5 py-2 text-sm text-neutral-600 hover:bg-neutral-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={dialogUploading}
                onClick={confirmMarkdownDialog}
                className="rounded-lg bg-neutral-900 px-3.5 py-2 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
              >
                插入{markdownDialog === "image" ? "图片" : markdownDialog === "gallery" ? "图片合集" : "链接"}
              </button>
            </div>
          </div>
        </div>
      )}
      {musicDialog && (
        <MusicInsertDialog
          onClose={(spec) => {
            setMusicDialog(false);
            if (spec) insertMusicBlock(spec);
          }}
        />
      )}
      {videoDialog && (
        <VideoInsertDialog
          onClose={(spec) => {
            setVideoDialog(false);
            if (spec) {
              insertVideoBlock(spec);
            } else {
              dialogRangeRef.current = null;
            }
          }}
        />
      )}
      {referenceDialog && (
        <ArticleReferenceDialog
          onClose={(selection) => {
            setReferenceDialog(false);
            if (selection) {
              if ("snapshot" in selection) {
                setReferenceSnapshots((current) => {
                  const next = current.filter((item) => item.canonicalUrl !== selection.snapshot.canonicalUrl);
                  return [...next, selection.snapshot];
                });
              }
              insertReferenceMarker(selection.marker, "siteReference" in selection);
            } else {
              dialogRangeRef.current = null;
            }
          }}
        />
      )}
    </div>
  );
}
