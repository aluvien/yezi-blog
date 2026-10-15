"use client";

import { useEffect, useRef, useState } from "react";
import { readEditorDraft, writeEditorDraft, type EditorDraft } from "@/lib/editor-draft";

const LEAVE = "内容还没有保存到网站，确定离开？浏览器草稿会保留在当前设备。";

export function useEditorDraft<T>({ draftKey, value, initial, restore, validate }: {
  draftKey: string; value: T; initial: T; restore: (value: T) => void; validate: (value: unknown) => value is T;
}) {
  const key = `yezi:editor:v1:${draftKey}`; // localStorage is already isolated by site origin.
  const [baseline] = useState(() => JSON.stringify(initial));
  const serialized = JSON.stringify(value);
  const dirty = serialized !== baseline;
  const [ready, setReady] = useState(false);
  const [offer, setOffer] = useState<EditorDraft | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState("");
  const completed = useRef(false);
  const current = useRef({ serialized, dirty, offer, ready });
  useEffect(() => { current.current = { serialized, dirty, offer, ready }; }, [serialized, dirty, offer, ready]);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const draft = readEditorDraft(localStorage, key);
        if (draft && draft.value !== baseline) setOffer(draft);
      } catch { setError("浏览器未允许保存草稿，请及时保存到网站。"); }
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [key, baseline]);

  useEffect(() => {
    if (!ready || offer) return;
    const timer = setTimeout(() => {
      if (completed.current) return;
      try { setSavedAt(writeEditorDraft(localStorage, key, baseline, serialized)); setError(""); }
      catch { setError("浏览器草稿保存失败，可能空间不足，请及时保存到网站。"); }
    }, 600);
    return () => clearTimeout(timer);
  }, [key, baseline, serialized, ready, offer]);

  useEffect(() => {
    const flush = () => {
      const state = current.current;
      if (!completed.current && state.ready && !state.offer) {
        try { writeEditorDraft(localStorage, key, baseline, state.serialized); } catch { /* The dirty warning still protects leaving. */ }
      }
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      flush();
      if (current.current.dirty && !completed.current) { event.preventDefault(); event.returnValue = ""; }
    };
    const click = (event: MouseEvent) => {
      if (!current.current.dirty || completed.current || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.download || (anchor.target && anchor.target !== "_self") || !/^https?:$/.test(anchor.protocol)) return;
      if (anchor.pathname === location.pathname && anchor.search === location.search && anchor.origin === location.origin) return;
      flush();
      if (!window.confirm(LEAVE)) { event.preventDefault(); event.stopPropagation(); }
    };
    // Navigation API supports cancellable history navigation in current Chromium.
    const navigation = (window as Window & { navigation?: EventTarget }).navigation;
    const navigate = (event: Event) => {
      if ((event as Event & { navigationType?: string }).navigationType !== "traverse" || !event.cancelable || !current.current.dirty || completed.current) return;
      flush();
      if (!window.confirm(LEAVE)) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flush);
    document.addEventListener("click", click, true);
    navigation?.addEventListener("navigate", navigate);
    return () => {
      flush();
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flush);
      document.removeEventListener("click", click, true);
      navigation?.removeEventListener("navigate", navigate);
    };
  }, [key, baseline]);

  function recover() {
    if (!offer) return;
    try {
      const parsed: unknown = JSON.parse(offer.value);
      if (!validate(parsed)) throw new Error("invalid");
      restore(parsed); setSavedAt(offer.savedAt); setOffer(null); setError("");
    } catch { setError("这份浏览器草稿格式不完整，无法恢复。可以放弃草稿后重新编辑。"); }
  }
  function discard() {
    try { localStorage.removeItem(key); setOffer(null); setSavedAt(null); setError(""); }
    catch { setError("浏览器草稿无法删除，请检查浏览器存储设置。"); }
  }
  function saved() {
    completed.current = true;
    try { localStorage.removeItem(key); } catch { /* Keep the old draft rather than lose data. */ }
  }
  return { offer, savedAt, error, dirty, changedOnServer: offer !== null && offer.baseline !== baseline, recover, discard, saved, confirmLeave: () => !dirty || window.confirm(LEAVE) };
}
