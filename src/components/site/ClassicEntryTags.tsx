"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type EntryTag = { tag: string; count: number };
type DialogDrag = { pointerId: number; startX: number; startY: number; startedAt: number; moved: boolean; blocked: boolean };

const DIALOG_DISMISS_DISTANCE = 96;
const DIALOG_DISMISS_FLICK_DISTANCE = 42;
const DIALOG_DISMISS_FLICK_VELOCITY = 0.8;

/** 经典归档页的标签入口：使用原生 dialog，保持键盘与移动端关闭行为。 */
export function ClassicEntryTags({ tags }: { tags: EntryTag[] }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<DialogDrag | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  function closeDialog() {
    const dialog = dialogRef.current;
    if (!dialog?.open) return;
    dialog.close();
    dragRef.current = null;
    setDragging(false);
    setDragOffset(0);
    // Safari may retain a native focus ring on the trigger after closing the
    // dialog. The content target itself has no outline, so clear this pointer
    // focus rather than leaving a blue box around “#标签”.
    requestAnimationFrame(() => triggerRef.current?.blur());
  }

  function startDialogDrag(event: React.PointerEvent<HTMLDialogElement>) {
    if (!dialogRef.current?.open || !event.isPrimary || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest(".entry-tags-dialog__head, .entry-tags-dialog__handle")) return;
    if (target.closest("button, a, input, select, textarea")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      moved: false,
      blocked: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDialogDrag(event: React.PointerEvent<HTMLDialogElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.blocked) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.max(10, Math.abs(deltaY) * 1.15)) {
      drag.blocked = true;
      return;
    }
    if (deltaY <= 4) return;
    drag.moved = true;
    setDragging(true);
    setDragOffset(Math.min(deltaY, 320));
    event.preventDefault();
  }

  function finishDialogDrag(event: React.PointerEvent<HTMLDialogElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.startY);
    const elapsed = Math.max(1, performance.now() - drag.startedAt);
    const velocity = distance / elapsed;
    const shouldDismiss = !drag.blocked && (distance >= DIALOG_DISMISS_DISTANCE || (distance >= DIALOG_DISMISS_FLICK_DISTANCE && velocity >= DIALOG_DISMISS_FLICK_VELOCITY));
    dragRef.current = null;
    setDragging(false);
    if (shouldDismiss) closeDialog();
    else setDragOffset(0);
  }

  function cancelDialogDrag(event: React.PointerEvent<HTMLDialogElement>) {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    setDragOffset(0);
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const closeOnBackdrop = (event: MouseEvent) => {
      if (event.target === dialog) closeDialog();
    };
    const closeOnCancel = (event: Event) => {
      event.preventDefault();
      closeDialog();
    };
    dialog.addEventListener("click", closeOnBackdrop);
    dialog.addEventListener("cancel", closeOnCancel);
    return () => {
      dialog.removeEventListener("click", closeOnBackdrop);
      dialog.removeEventListener("cancel", closeOnCancel);
    };
  }, []);

  function openDialog() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="page-subtitle__action page-subtitle__item entry-tags-trigger"
        aria-haspopup="dialog"
        aria-controls="archive-tags"
        onClick={openDialog}
      >
        #标签
      </button>
      <dialog
        ref={dialogRef}
        id="archive-tags"
        className={`entry-tags-dialog${dragging ? " is-dragging" : ""}`}
        style={{ "--entry-tags-drag-y": `${dragOffset}px` } as React.CSSProperties}
        aria-labelledby="archive-tags-title"
        onPointerDown={startDialogDrag}
        onPointerMove={moveDialogDrag}
        onPointerUp={finishDialogDrag}
        onPointerCancel={cancelDialogDrag}
      >
        <div className="entry-tags-dialog__inner">
          <span className="entry-tags-dialog__handle" aria-hidden="true" />
          <header className="entry-tags-dialog__head">
            <div className="entry-tags-dialog__title-wrap">
              <div className="entry-tags-dialog__title-row">
                <h2 id="archive-tags-title" className="entry-tags-dialog__title" tabIndex={-1}>归档标签</h2>
                <p className="entry-tags-dialog__hint">共 {tags.length} 个标签</p>
              </div>
            </div>
            <div className="entry-tags-dialog__actions">
              <button type="button" className="entry-tags-dialog__close" aria-label="关闭标签" onClick={closeDialog}>×</button>
            </div>
          </header>
          {tags.length > 0 ? (
            <div className="entry-tags-dialog__list">
              {tags.map(({ tag, count }) => (
                <Link key={tag} className="entry-tag-option" href={`/tags/${encodeURIComponent(tag)}`} onClick={closeDialog}>
                  <span className="entry-tag-option__label">#{tag}</span>
                  <span className="entry-tag-option__count">{count}</span>
                </Link>
              ))}
            </div>
          ) : (
            <div className="entry-tags-fallback">
              <p className="entry-tags-fallback__title">还没有标签</p>
              <p className="entry-tags-fallback__hint">发布文章并添加标签后，会显示在这里。</p>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
