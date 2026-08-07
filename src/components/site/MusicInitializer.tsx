"use client";

import { useEffect, useRef } from "react";
import { fetchMusicTracks, type MusicSpec, type MusicTrack } from "@/lib/music";
import { getGlobalPlaybackState, requestGlobalPlay, setGlobalStateListener } from "@/lib/player-store";
import { lyricAt, parseLrc, type LyricLine } from "@/lib/lyrics";

type CardSwipeDirection = "next" | "previous";

type CardSwipeGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  width: number;
  axis: "x" | "y" | null;
  offset: number;
  direction: CardSwipeDirection | null;
  targetIndex: number | null;
};

/** 依据全局播放状态刷新单张卡片：命中即显示"正在播放"（等化器动效），否则回到静态三角。 */
function syncCardState(card: HTMLElement, state: ReturnType<typeof getGlobalPlaybackState>) {
  const id = card.dataset.cardId;
  const isPlaying = state.playing && Boolean(id) && state.cardId === id;
  card.classList.toggle("is-playing", isPlaying);
  const playEl = card.querySelector<HTMLElement>(".music-trigger-play");
  if (!playEl) return;
  if (isPlaying) {
    if (!playEl.querySelector(".eq-bar")) {
      playEl.innerHTML = '<i class="eq-bar"></i><i class="eq-bar"></i><i class="eq-bar"></i>';
    }
  } else {
    // 清空子节点，恢复 CSS ::before 的播放三角
    playEl.innerHTML = "";
  }
}

/**
 * 全站音乐触发卡片初始化器。
 *
 * 全局唯一 APlayer 由 GlobalMusicPlayer 常驻在布局持久层管理（保证站内导航不中断播放）。
 * 本组件只负责把文章/想法里的 `.blog-music` 容器渲染成可点击的"触发卡片"
 * （封面 + 歌名 + 当前歌词 + 播放按钮），点击后把曲目追加到全局播放器列表末尾并播放；
 * 同时订阅全局播放状态，把"正在播放"回显到对应卡片（图标切换为等化器动效）。
 *
 * 挂在 SiteLayoutInner 上，文章与想法均可触发；SPA 导航新增的容器由 MutationObserver 扫描。
 */
export function MusicInitializer({ metingApi }: { metingApi: string }) {
  const apiRef = useRef(metingApi);
  const cardSeqRef = useRef(0);
  useEffect(() => {
    apiRef.current = metingApi;
  }, [metingApi]);

  useEffect(() => {
    type CardMusicState = {
      tracks: MusicTrack[];
      lyrics: Map<string, LyricLine[]>;
      loading: Set<string>;
      activeIndex: number;
      gesture: CardSwipeGesture | null;
      swipeFrame: number | null;
      suppressClick: boolean;
    };
    const cardMusicState = new WeakMap<HTMLElement, CardMusicState>();
    const cardSwipeCleanups = new Set<() => void>();

    function trackKey(track: MusicTrack): string {
      return track.key?.trim() || track.url.trim() || `${track.name}\u0000${track.artist}`;
    }

    function preloadTrackCover(track: MusicTrack | undefined): void {
      if (!track?.cover) return;
      const image = new Image();
      image.decoding = "async";
      image.src = track.cover;
    }

    function renderTrackSlide(slide: HTMLElement, track: MusicTrack): void {
      const key = trackKey(track);
      if (slide.dataset.trackKey === key) return;
      slide.dataset.trackKey = key;
      const img = slide.querySelector<HTMLImageElement>("img");
      const cover = slide.querySelector<HTMLElement>(".music-trigger-cover");
      const nameEl = slide.querySelector<HTMLElement>(".music-trigger-name");
      const artistEl = slide.querySelector<HTMLElement>(".music-trigger-artist-name");
      const lyricEl = slide.querySelector<HTMLElement>(".music-trigger-lyric");
      if (nameEl) nameEl.textContent = track.name;
      if (artistEl) artistEl.textContent = track.artist || "";
      if (lyricEl) setLyricText(lyricEl, "", false);
      if (!img || !cover) return;
      img.decoding = "async";
      img.draggable = false;
      cover.classList.remove("is-fallback");
      img.onerror = () => {
        img.removeAttribute("src");
        cover.classList.add("is-fallback");
      };
      if (track.cover) {
        img.src = track.cover;
      } else {
        img.removeAttribute("src");
        cover.classList.add("is-fallback");
      }
    }

    function renderCardTrack(card: HTMLElement, data: CardMusicState, index: number): MusicTrack | null {
      if (data.tracks.length === 0) return null;
      const safeIndex = Math.max(0, Math.min(index, data.tracks.length - 1));
      data.activeIndex = safeIndex;
      const track = data.tracks[safeIndex];
      const slide = card.querySelector<HTMLElement>('[data-track-slot="current"]');
      if (slide) renderTrackSlide(slide, track);
      const titleEl = slide?.querySelector<HTMLElement>(".music-trigger-name");
      if (titleEl) {
        titleEl.textContent = data.tracks.length === 1 ? track.name : `${track.name} 等 ${data.tracks.length} 首`;
      }
      preloadTrackCover(data.tracks[(safeIndex + 1) % data.tracks.length]);
      preloadTrackCover(data.tracks[(safeIndex - 1 + data.tracks.length) % data.tracks.length]);
      return track;
    }

    function adjacentTrack(data: CardMusicState, direction: CardSwipeDirection): { index: number; track: MusicTrack } | null {
      if (data.tracks.length < 2) return null;
      const index = direction === "next"
        ? (data.activeIndex + 1) % data.tracks.length
        : (data.activeIndex - 1 + data.tracks.length) % data.tracks.length;
      return { index, track: data.tracks[index] };
    }

    function slideElements(card: HTMLElement): { stage: HTMLElement; current: HTMLElement; preview: HTMLElement } | null {
      const stage = card.querySelector<HTMLElement>(".music-trigger-swipe-stage");
      const current = card.querySelector<HTMLElement>('[data-track-slot="current"]');
      const preview = card.querySelector<HTMLElement>('[data-track-slot="preview"]');
      if (!stage || !current || !preview) return null;
      return { stage, current, preview };
    }

    async function loadLyrics(card: HTMLElement, track: MusicTrack, data: CardMusicState): Promise<void> {
      const key = trackKey(track);
      if (!track.lrc || data.loading.has(key) || data.lyrics.has(key)) return;
      data.loading.add(key);
      try {
        const response = await fetch(track.lrc, { signal: AbortSignal.timeout(10000) });
        if (response.ok) data.lyrics.set(key, parseLrc(await response.text()));
        else data.lyrics.set(key, []);
      } catch {
        data.lyrics.set(key, []);
      } finally {
        data.loading.delete(key);
        syncCardLyric(card, getGlobalPlaybackState());
      }
    }

    function setLyricText(lyricEl: HTMLElement, text: string, visible: boolean): void {
      const textEl = lyricEl.querySelector<HTMLElement>(".music-trigger-lyric-text");
      if (!textEl) return;
      textEl.textContent = text;
      lyricEl.classList.toggle("is-visible", visible);
      lyricEl.classList.remove("is-long");
      lyricEl.style.removeProperty("--lyric-shift");
      if (!visible) return;
      requestAnimationFrame(() => {
        const overflow = Math.max(0, textEl.scrollWidth - lyricEl.clientWidth);
        lyricEl.classList.toggle("is-long", overflow > 2);
        lyricEl.style.setProperty("--lyric-shift", `${-overflow}px`);
      });
    }

    function syncCardLyric(card: HTMLElement, state: ReturnType<typeof getGlobalPlaybackState>): void {
      const lyricEl = card.querySelector<HTMLElement>(".music-trigger-lyric");
      const data = cardMusicState.get(card);
      if (!lyricEl || !data) return;
      const isCurrentCard = Boolean(card.dataset.cardId) && state.cardId === card.dataset.cardId;
      const isPlaying = isCurrentCard && state.playing;
      const track = hasTrackKey(state.trackKey, data.tracks)
        ? data.tracks.find((item) => trackKey(item) === state.trackKey)
        : data.tracks[data.activeIndex] ?? data.tracks[0];
      card.classList.toggle("has-lyric", isPlaying && Boolean(track));
      if (!isPlaying || !track) {
        setLyricText(lyricEl, "", false);
        return;
      }
      const key = trackKey(track);
      const lines = data.lyrics.get(key);
      if (!lines) {
        setLyricText(lyricEl, track.lrc ? "歌词加载中…" : "暂无歌词", true);
        void loadLyrics(card, track, data);
        return;
      }
      setLyricText(lyricEl, lines.length > 0 ? (lyricAt(lines, state.currentTime) || "♪") : "暂无歌词", true);
    }

    function hasTrackKey(trackKeyValue: string | null, tracks: MusicTrack[]): boolean {
      return Boolean(trackKeyValue && tracks.some((item) => trackKey(item) === trackKeyValue));
    }

    function syncCardTitle(card: HTMLElement, state: ReturnType<typeof getGlobalPlaybackState>): void {
      const data = cardMusicState.get(card);
      if (!data || data.tracks.length === 0) return;
      const isCurrentCard = Boolean(card.dataset.cardId) && state.cardId === card.dataset.cardId;
      const currentIndex = isCurrentCard
        ? data.tracks.findIndex((item) => trackKey(item) === state.trackKey)
        : -1;
      renderCardTrack(card, data, currentIndex >= 0 ? currentIndex : data.activeIndex);
    }

    function syncCard(card: HTMLElement, state: ReturnType<typeof getGlobalPlaybackState>): void {
      syncCardTitle(card, state);
      syncCardState(card, state);
      syncCardLyric(card, state);
    }

    function setSlideTransition(elements: { current: HTMLElement; preview: HTMLElement }, animated: boolean): void {
      elements.current.style.transition = animated ? "transform 280ms cubic-bezier(0.22, 1, 0.36, 1)" : "none";
      elements.preview.style.transition = animated
        ? "transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease"
        : "none";
    }

    function settleCardSwipe(card: HTMLElement, data: CardMusicState, gesture: CardSwipeGesture): void {
      const elements = slideElements(card);
      if (!elements || !gesture.direction) return;
      const direction = gesture.direction;
      const targetIndex = gesture.targetIndex;
      const targetTrack = targetIndex === null ? null : data.tracks[targetIndex];
      if (!targetTrack || targetIndex === null) {
        cancelCardSwipe(card, data, direction);
        return;
      }

      renderTrackSlide(elements.preview, targetTrack);
      setSlideTransition(elements, true);
      elements.current.style.transform = direction === "next" ? "translate3d(-100%, 0, 0)" : "translate3d(100%, 0, 0)";
      elements.preview.style.transform = "translate3d(0, 0, 0)";
      elements.preview.style.opacity = "1";

      const onExit = (event: TransitionEvent): void => {
        if (event.target !== elements.current || event.propertyName !== "transform") return;
        elements.current.removeEventListener("transitionend", onExit);
        setSlideTransition(elements, false);
        data.activeIndex = targetIndex;

        // 目标预览已经完整停在中间，直接交换 current/preview 身份。
        // 不再把目标内容重新写进旧卡片并做第二次回场，避免图片和文字闪烁。
        elements.current.dataset.trackSlot = "preview";
        elements.current.classList.add("music-trigger-swipe-preview");
        elements.current.setAttribute("aria-hidden", "true");
        elements.current.style.opacity = "0";
        elements.preview.dataset.trackSlot = "current";
        elements.preview.classList.remove("music-trigger-swipe-preview");
        elements.preview.removeAttribute("aria-hidden");
        elements.preview.style.transform = "translate3d(0, 0, 0)";
        elements.preview.style.opacity = "1";
        elements.stage.classList.remove("is-dragging");

        const nextTrack = renderCardTrack(card, data, targetIndex);
        if (!nextTrack) return;
        requestGlobalPlay({ tracks: data.tracks, cardId: card.dataset.cardId, trackKey: trackKey(nextTrack) });
        window.setTimeout(() => {
          data.suppressClick = false;
        }, 320);
      };
      elements.current.addEventListener("transitionend", onExit);
    }

    function cancelCardSwipe(card: HTMLElement, data: CardMusicState, direction: CardSwipeDirection): void {
      const elements = slideElements(card);
      if (!elements) return;
      setSlideTransition(elements, true);
      elements.current.style.transform = "translate3d(0, 0, 0)";
      elements.preview.style.transform = direction === "next" ? "translate3d(100%, 0, 0)" : "translate3d(-100%, 0, 0)";
      elements.preview.style.opacity = "0";
      const onReset = (event: TransitionEvent): void => {
        if (event.target !== elements.current || event.propertyName !== "transform") return;
        elements.current.removeEventListener("transitionend", onReset);
        elements.stage.classList.remove("is-dragging");
        setSlideTransition(elements, false);
      };
      elements.current.addEventListener("transitionend", onReset);
      window.setTimeout(() => {
        data.suppressClick = false;
        elements.current.removeEventListener("transitionend", onReset);
      }, 500);
    }

    function bindCardSwipe(card: HTMLElement, data: CardMusicState): (() => void) | null {
      const initialElements = slideElements(card);
      if (!initialElements || data.tracks.length < 2) return null;
      const { stage } = initialElements;

      const paintGesture = (gesture: CardSwipeGesture): void => {
        const elements = slideElements(card);
        if (!elements || !gesture.direction || gesture.targetIndex === null) return;
        const targetTrack = data.tracks[gesture.targetIndex];
        if (!targetTrack) return;
        renderTrackSlide(elements.preview, targetTrack);
        const previewTitle = elements.preview.querySelector<HTMLElement>(".music-trigger-name");
        if (previewTitle) {
          previewTitle.textContent = data.tracks.length === 1 ? targetTrack.name : `${targetTrack.name} 等 ${data.tracks.length} 首`;
        }
        elements.stage.classList.add("is-dragging");
        setSlideTransition(elements, false);
        elements.current.style.transform = `translate3d(${gesture.offset}px, 0, 0)`;
        elements.preview.style.transform = gesture.direction === "next"
          ? `translate3d(calc(100% + ${gesture.offset}px), 0, 0)`
          : `translate3d(calc(-100% + ${gesture.offset}px), 0, 0)`;
        elements.preview.style.opacity = "1";
      };

      const onPointerDown = (event: PointerEvent): void => {
        if (data.gesture || event.button !== 0) return;
        data.gesture = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          startedAt: performance.now(),
          width: stage.getBoundingClientRect().width,
          axis: null,
          offset: 0,
          direction: null,
          targetIndex: null,
        };
      };

      const onPointerMove = (event: PointerEvent): void => {
        const gesture = data.gesture;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const deltaX = event.clientX - gesture.startX;
        const deltaY = event.clientY - gesture.startY;
        if (!gesture.axis) {
          if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < 8) return;
          if (Math.abs(deltaY) > Math.abs(deltaX)) {
            gesture.axis = "y";
            data.gesture = null;
            return;
          }
          gesture.axis = "x";
          stage.setPointerCapture(event.pointerId);
        }
        if (gesture.axis !== "x") return;
        event.preventDefault();
        const direction: CardSwipeDirection = deltaX < 0 ? "next" : "previous";
        const target = adjacentTrack(data, direction);
        if (!target) return;
        const width = gesture.width || stage.getBoundingClientRect().width || 1;
        const offset = Math.max(-width * 0.72, Math.min(width * 0.72, deltaX));
        gesture.offset = offset;
        gesture.direction = direction;
        gesture.targetIndex = target.index;
        data.suppressClick = true;
        if (data.swipeFrame === null) {
          data.swipeFrame = requestAnimationFrame(() => {
            data.swipeFrame = null;
            if (data.gesture) paintGesture(data.gesture);
          });
        }
      };

      const onPointerEnd = (event: PointerEvent): void => {
        const gesture = data.gesture;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        if (data.swipeFrame !== null) {
          cancelAnimationFrame(data.swipeFrame);
          data.swipeFrame = null;
          paintGesture(gesture);
        }
        data.gesture = null;
        if (gesture.axis !== "x") return;
        try {
          stage.releasePointerCapture(event.pointerId);
        } catch {
          // 指针捕获可能已经由浏览器在取消事件中释放。
        }
        if (event.type === "pointercancel") {
          data.suppressClick = false;
          cancelCardSwipe(card, data, gesture.direction ?? "next");
          return;
        }
        const width = gesture.width || stage.getBoundingClientRect().width || 1;
        const threshold = Math.max(42, width / 3);
        const elapsed = Math.max(1, performance.now() - gesture.startedAt);
        const speed = Math.abs(gesture.offset) / elapsed;
        // 普通滑动需超过卡片 1/3；快速轻扫允许用速度触发，但至少移动 24px，避免点击误触。
        const fastSwipe = Math.abs(gesture.offset) >= 24 && speed >= 0.8;
        const shouldCommit = Boolean(gesture.direction)
          && gesture.targetIndex !== null
          && (Math.abs(gesture.offset) >= threshold || fastSwipe);
        if (shouldCommit) {
          settleCardSwipe(card, data, gesture);
        } else {
          cancelCardSwipe(card, data, gesture.direction ?? "next");
        }
      };

      stage.addEventListener("pointerdown", onPointerDown);
      stage.addEventListener("pointermove", onPointerMove);
      stage.addEventListener("pointerup", onPointerEnd);
      stage.addEventListener("pointercancel", onPointerEnd);
      return () => {
        if (data.swipeFrame !== null) cancelAnimationFrame(data.swipeFrame);
        stage.removeEventListener("pointerdown", onPointerDown);
        stage.removeEventListener("pointermove", onPointerMove);
        stage.removeEventListener("pointerup", onPointerEnd);
        stage.removeEventListener("pointercancel", onPointerEnd);
      };
    }

    async function initContainer(el: HTMLElement) {
      if (el.dataset.init === "1") return;
      const server = el.dataset.server;
      const id = el.dataset.id;
      const type = el.dataset.type;
      if (!server || !id || !type) return;
      el.dataset.init = "1";
      const spec = { server, id, type, shuffle: el.dataset.shuffle === "1" } as MusicSpec;

      const card = document.createElement("div");
      card.className = "music-trigger";
      card.dataset.cardId = String(cardSeqRef.current++);
      card.innerHTML = `
        <span class="music-trigger-swipe-stage" aria-label="左右滑动切换歌曲">
          <span class="music-trigger-swipe-slide" data-track-slot="current">
            <span class="music-trigger-cover"><img alt="" loading="lazy" /></span>
            <span class="music-trigger-info">
              <span class="music-trigger-name">音乐加载中…</span>
              <span class="music-trigger-artist">
                <span class="music-trigger-artist-name"></span>
                <span class="music-trigger-lyric" aria-live="polite"><span class="music-trigger-lyric-text"></span></span>
              </span>
            </span>
          </span>
          <span class="music-trigger-swipe-slide music-trigger-swipe-preview" data-track-slot="preview" aria-hidden="true">
            <span class="music-trigger-cover"><img alt="" loading="lazy" /></span>
            <span class="music-trigger-info">
              <span class="music-trigger-name"></span>
              <span class="music-trigger-artist"><span class="music-trigger-artist-name"></span></span>
            </span>
          </span>
        </span>
        <span class="music-trigger-play" aria-hidden="true"></span>
      `;
      el.replaceChildren(card);

      let tracks: MusicTrack[] = [];
      try {
        tracks = await fetchMusicTracks(apiRef.current, spec);
      } catch {
        card.classList.add("is-error");
        card.querySelector(".music-trigger-name")!.textContent = "音乐暂不可用（版权或接口异常）";
        return;
      }
      if (tracks.length === 0) {
        card.classList.add("is-error");
        card.querySelector(".music-trigger-name")!.textContent = "音乐暂不可用（版权或接口异常）";
        return;
      }

      const data: CardMusicState = { tracks, lyrics: new Map(), loading: new Set(), activeIndex: 0, gesture: null, swipeFrame: null, suppressClick: false };
      cardMusicState.set(card, data);
      renderCardTrack(card, data, 0);
      const swipeCleanup = bindCardSwipe(card, data);
      card.classList.add("is-ready");
      // 新卡片同步一次当前播放状态（可能是正在播放的这张卡）
      syncCard(card, getGlobalPlaybackState());

      // 点击整张卡片：追加到全局播放器并播放（曲目已拉取，直接复用）。
      card.addEventListener("click", (event) => {
        if (data.suppressClick) {
          data.suppressClick = false;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        const activeTrack = data.tracks[data.activeIndex] ?? data.tracks[0];
        requestGlobalPlay({ tracks: data.tracks, cardId: card.dataset.cardId, trackKey: trackKey(activeTrack) });
      });
      if (swipeCleanup) cardSwipeCleanups.add(swipeCleanup);
    }

    function scan(root: Node) {
      const targets: HTMLElement[] = [];
      if (root instanceof HTMLElement && root.classList.contains("blog-music")) targets.push(root);
      if (root instanceof HTMLElement && root.querySelectorAll) {
        root.querySelectorAll<HTMLElement>(".blog-music").forEach((el) => targets.push(el));
      }
      targets.forEach((el) => {
        void initContainer(el);
      });
    }

    scan(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) scan(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // 订阅全局播放状态：切歌/暂停/结束/取消时刷新所有卡片图标
    const unsubscribeState = setGlobalStateListener(() => {
      const state = getGlobalPlaybackState();
      document.querySelectorAll<HTMLElement>(".music-trigger").forEach((card) => syncCard(card, state));
    });

    return () => {
      observer.disconnect();
      unsubscribeState();
      cardSwipeCleanups.forEach((cleanup) => cleanup());
      cardSwipeCleanups.clear();
    };
  }, []);

  return null;
}
