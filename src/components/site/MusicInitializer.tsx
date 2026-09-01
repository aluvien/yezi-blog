"use client";

import { useEffect, useRef } from "react";
import { compactMusicCoverUrl, fetchMusicMetadata, fetchMusicTracks, parseMusicSpec, type MusicSpec, type MusicTrack } from "@/lib/music";
import {
  getGlobalPlaybackState,
  isGlobalPlaybackActiveForCard,
  requestGlobalPlay,
  setGlobalStateListener,
} from "@/lib/player-store";
import { getMusicLyrics } from "@/lib/music-lyrics";
import { lyricAt, type LyricLine } from "@/lib/lyrics";

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
function syncCardState(
  card: HTMLElement,
  state: ReturnType<typeof getGlobalPlaybackState>,
  matchesCurrentTrack: boolean,
) {
  const id = card.dataset.cardId;
  const isPlaying = isGlobalPlaybackActiveForCard(state, id, matchesCurrentTrack);
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
export function MusicInitializer() {
  const cardSeqRef = useRef(0);

  useEffect(() => {
    type CardMusicState = {
      tracks: MusicTrack[];
      lyrics: Map<string, LyricLine[]>;
      loading: Set<string>;
      activeIndex: number;
      gesture: CardSwipeGesture | null;
      swipeFrame: number | null;
      suppressClick: boolean;
      playAfterResolve: boolean;
      spec: MusicSpec;
      metadataPromise: Promise<MusicTrack[]> | null;
      resolvePromise: Promise<MusicTrack[]> | null;
    };
    const cardMusicState = new WeakMap<HTMLElement, CardMusicState>();
    const cardSwipeCleanups = new Map<HTMLElement, () => void>();

    function trackKey(track: MusicTrack): string {
      return track.key?.trim() || track.url.trim() || `${track.name}\u0000${track.artist}`;
    }

    function comparableTrackText(value: string): string {
      return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
    }

    function trackMatchesState(track: MusicTrack, state: ReturnType<typeof getGlobalPlaybackState>): boolean {
      if (state.trackKey && trackKey(track) === state.trackKey) return true;
      const stateName = comparableTrackText(state.trackName || "");
      const trackName = comparableTrackText(track.name);
      if (!stateName || !trackName || stateName !== trackName) return false;
      const stateArtist = comparableTrackText(state.trackArtist || "");
      const trackArtist = comparableTrackText(track.artist || "");
      return !stateArtist || !trackArtist || stateArtist === trackArtist
        || stateArtist.includes(trackArtist)
        || trackArtist.includes(stateArtist);
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
      img.classList.remove("site-image-ready");
      img.classList.add("site-image-loading");
      img.onload = () => {
        img.classList.remove("site-image-loading");
        img.classList.add("site-image-ready");
      };
      cover.classList.remove("is-fallback");
      img.onerror = () => {
        img.removeAttribute("src");
        img.classList.remove("site-image-loading");
        img.classList.add("site-image-ready");
        cover.classList.add("is-fallback");
      };
      if (track.cover) {
        img.src = track.cover;
      } else {
        img.removeAttribute("src");
        img.classList.remove("site-image-loading");
        img.classList.add("site-image-ready");
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
        const total = track.playlistTotal ?? data.tracks.length;
        titleEl.textContent = total === 1 ? track.name : `${track.name} 等 ${total} 首`;
      }
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

    async function loadLyrics(card: HTMLElement, track: MusicTrack, data: CardMusicState, sourceOverride?: string): Promise<void> {
      const source = sourceOverride?.trim() || track.lrc.trim();
      const key = `${trackKey(track)}\u0000${source}`;
      if (!source || data.loading.has(key) || data.lyrics.has(key)) return;
      data.loading.add(key);
      try {
        data.lyrics.set(key, await getMusicLyrics(track, source));
      } catch {
        // 共享歌词层已将网络错误归一为无歌词，这里仅兜底保护卡片状态。
        data.lyrics.set(key, []);
      } finally {
        data.loading.delete(key);
        syncCardLyric(card, getGlobalPlaybackState());
      }
    }

    function lyricCacheKey(track: MusicTrack, source: string): string {
      return `${trackKey(track)}\u0000${source}`;
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
      const lyricEl = card.querySelector<HTMLElement>('[data-track-slot="current"] .music-trigger-lyric');
      const data = cardMusicState.get(card);
      if (!lyricEl || !data) return;
      const isCurrentCard = Boolean(card.dataset.cardId) && state.cardId === card.dataset.cardId;
      const matchesCurrentTrack = data.tracks.some((item) => trackMatchesState(item, state));
      // `cardId` only identifies which card owns the play/pause animation.
      // A song selected from the expanded global list can have no card owner
      // (for example, a default playlist item), but the inline card should
      // still show lyrics whenever its track key matches the current song.
      const isPlaying = state.playing && (isCurrentCard || matchesCurrentTrack);
      const track = matchesCurrentTrack
        ? data.tracks.find((item) => trackMatchesState(item, state))
        : data.tracks[data.activeIndex] ?? data.tracks[0];
      card.classList.toggle("has-lyric", isPlaying && Boolean(track));
      if (!isPlaying || !track) {
        setLyricText(lyricEl, "", false);
        return;
      }
      const isCurrentTrack = trackMatchesState(track, state);
      // 使用全局播放器当前实际加载的歌词地址，保证卡片和展开播放器一致。
      if (isCurrentTrack && state.lyricText) {
        setLyricText(lyricEl, state.lyricText, true);
        return;
      }
      const source = isCurrentTrack && state.lrc ? state.lrc : track.lrc;
      const key = lyricCacheKey(track, source);
      const lines = data.lyrics.get(key);
      if (!lines) {
        setLyricText(lyricEl, source ? "歌词加载中…" : "暂无歌词", true);
        void loadLyrics(card, track, data, source);
        return;
      }
      setLyricText(lyricEl, lines.length > 0 ? (lyricAt(lines, state.currentTime) || "♪") : "暂无歌词", true);
    }

    function syncCardTitle(card: HTMLElement, state: ReturnType<typeof getGlobalPlaybackState>): boolean {
      const data = cardMusicState.get(card);
      if (!data || data.tracks.length === 0) return false;
      const currentIndex = state.playing
        ? data.tracks.findIndex((item) => trackMatchesState(item, state))
        : -1;
      renderCardTrack(card, data, currentIndex >= 0 ? currentIndex : data.activeIndex);
      return currentIndex >= 0;
    }

    function syncCard(card: HTMLElement, state: ReturnType<typeof getGlobalPlaybackState>): void {
      const matchesCurrentTrack = syncCardTitle(card, state);
      syncCardState(card, state, matchesCurrentTrack);
      syncCardLyric(card, state);
    }

    function resolveTracks(card: HTMLElement, data: CardMusicState): Promise<MusicTrack[]> {
      if (data.tracks[0]?.url) return Promise.resolve(data.tracks);
      if (data.resolvePromise) return data.resolvePromise;
      const hasDisplaySnapshot = data.tracks.length > 0;
      card.classList.remove("is-error", "is-slow");
      card.classList.toggle("is-pending", !hasDisplaySnapshot);
      card.classList.toggle("is-resolving", hasDisplaySnapshot);
      card.setAttribute("aria-busy", "true");
      card.setAttribute("aria-label", "正在加载音乐");
      const selectedKey = data.tracks[data.activeIndex] ? trackKey(data.tracks[data.activeIndex]) : "";
      const slowTimer = window.setTimeout(() => {
        // 不把快照替换成错误文字：请求较慢时仍保留用户已经看到的歌名、歌手和封面。
        if (data.resolvePromise) {
          card.classList.add("is-slow");
          card.setAttribute("aria-label", "音乐加载较慢，仍在连接");
        }
      }, 2_400);
      data.resolvePromise = fetchMusicTracks(data.spec)
        .then((tracks) => {
          if (tracks.length === 0) throw new Error("音乐暂不可用");
          if (data.spec.server === "qqvip" && tracks[0] && data.spec.title) {
            tracks[0] = {
              ...tracks[0],
              name: data.spec.title,
              artist: data.spec.artist || tracks[0].artist,
              cover: data.spec.cover || tracks[0].cover,
            };
          }
          data.tracks = tracks;
          const selectedIndex = selectedKey ? tracks.findIndex((track) => trackKey(track) === selectedKey) : -1;
          data.activeIndex = selectedIndex >= 0 ? selectedIndex : Math.min(data.activeIndex, tracks.length - 1);
          renderCardTrack(card, data, data.activeIndex);
          syncCard(card, getGlobalPlaybackState());
          card.classList.remove("is-error", "is-pending", "is-resolving", "is-slow");
          card.classList.add("is-ready");
          card.setAttribute("aria-busy", "false");
          card.removeAttribute("aria-label");
          if (!cardSwipeCleanups.has(card)) {
            const swipeCleanup = bindCardSwipe(card, data);
            if (swipeCleanup) cardSwipeCleanups.set(card, swipeCleanup);
          }
          return tracks;
        })
        .catch((error) => {
          card.classList.add("is-error");
          card.classList.remove("is-pending", "is-resolving", "is-slow");
          card.setAttribute("aria-busy", "false");
          card.setAttribute("aria-label", "音乐暂时无法加载，可点击重试");
          const title = card.querySelector<HTMLElement>(".music-trigger-name");
          // 有首屏快照时保留歌曲信息；没有快照才以错误信息替代占位文本。
          if (title && !data.tracks[0]?.name) title.textContent = error instanceof Error ? error.message : "音乐暂不可用";
          throw error;
        })
        .finally(() => {
          window.clearTimeout(slowTimer);
          data.resolvePromise = null;
        });
      return data.resolvePromise;
    }

    /** 可视范围内只读取本站已缓存的名称、歌手和封面，绝不提前请求播放地址。 */
    function resolveMetadata(card: HTMLElement, data: CardMusicState): Promise<MusicTrack[]> {
      if (data.tracks[0]?.name) return Promise.resolve(data.tracks);
      if (data.metadataPromise) return data.metadataPromise;
      card.classList.remove("is-error", "is-slow");
      card.classList.add("is-pending");
      card.setAttribute("aria-busy", "true");
      data.metadataPromise = fetchMusicMetadata(data.spec)
        .then((tracks) => {
          // 用户在元数据请求完成前点击播放时，完整曲目信息优先，不能被空 URL 覆盖。
          if (data.tracks[0]?.url) return data.tracks;
          if (tracks.length > 0) {
            data.tracks = tracks;
            data.activeIndex = 0;
            renderCardTrack(card, data, 0);
            syncCard(card, getGlobalPlaybackState());
            card.classList.add("is-ready");
            if (!cardSwipeCleanups.has(card)) {
              const swipeCleanup = bindCardSwipe(card, data);
              if (swipeCleanup) cardSwipeCleanups.set(card, swipeCleanup);
            }
          }
          card.classList.remove("is-pending");
          card.setAttribute("aria-busy", "false");
          return data.tracks;
        })
        .catch(() => {
          // 缓存尚未建立或网络短暂异常时仍允许点击播放；届时才请求 QQ 播放地址。
          card.classList.remove("is-pending");
          card.setAttribute("aria-busy", "false");
          const title = card.querySelector<HTMLElement>(".music-trigger-name");
          if (title && !data.tracks[0]?.name) title.textContent = "点击加载音乐";
          return data.tracks;
        })
        .finally(() => {
          data.metadataPromise = null;
        });
      return data.metadataPromise;
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

    function initContainer(el: HTMLElement) {
      if (el.dataset.init === "1") return;
      // React 渲染的想法卡片必须等自身完成水合；Markdown HTML 容器在服务端已标记。
      if (el.dataset.hydrated !== "1") return;
      const server = el.dataset.server;
      const id = el.dataset.id;
      const type = el.dataset.type;
      if (!server || !id || !type) return;
      const parsedSpec = parseMusicSpec(`${server}:${id}:${type}${el.dataset.shuffle === "1" ? ":random" : ""}`);
      if (!parsedSpec) {
        el.dataset.init = "1";
        el.textContent = "QQ 音乐规格无效或已不再支持";
        el.classList.add("is-error");
        return;
      }
      el.dataset.init = "1";
      const spec = {
        ...parsedSpec,
        title: el.dataset.musicName?.trim() || "",
        artist: el.dataset.musicArtist?.trim() || "",
        cover: compactMusicCoverUrl(el.dataset.musicCover?.trim() || ""),
      } satisfies MusicSpec;

      const card = document.createElement("div");
      card.className = "music-trigger";
      card.dataset.cardId = String(cardSeqRef.current++);
      card.setAttribute("aria-busy", "true");
      card.innerHTML = `
        <span class="music-trigger-swipe-stage" aria-label="左右滑动切换歌曲">
          <span class="music-trigger-swipe-slide" data-track-slot="current">
            <span class="music-trigger-cover"><img class="site-image-media site-image-loading" alt="" loading="lazy" /></span>
            <span class="music-trigger-info">
              <span class="music-trigger-name">音乐加载中…</span>
              <span class="music-trigger-artist">
                <span class="music-trigger-artist-name"></span>
                <span class="music-trigger-lyric" aria-live="polite"><span class="music-trigger-lyric-text"></span></span>
              </span>
            </span>
          </span>
          <span class="music-trigger-swipe-slide music-trigger-swipe-preview" data-track-slot="preview" aria-hidden="true">
            <span class="music-trigger-cover"><img class="site-image-media site-image-loading" alt="" loading="lazy" /></span>
            <span class="music-trigger-info">
              <span class="music-trigger-name"></span>
              <span class="music-trigger-artist">
                <span class="music-trigger-artist-name"></span>
                <span class="music-trigger-lyric" aria-live="polite"><span class="music-trigger-lyric-text"></span></span>
              </span>
            </span>
          </span>
        </span>
        <span class="music-trigger-play" aria-hidden="true"></span>
        <button class="music-trigger-retry" type="button" aria-label="重新加载音乐" title="重新加载音乐">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0 1.1 4"/><path d="M20 4v7h-7"/></svg>
        </button>
      `;
      el.replaceChildren(card);

      let tracks: MusicTrack[] = [];
      // QQ 搜索引用已携带展示快照，首屏直接渲染；没有快照的旧引用先显示骨架，进入视口后再取详情。
      if (spec.title) {
        const current = card.querySelector<HTMLElement>('[data-track-slot="current"]');
        if (current) {
          renderTrackSlide(current, {
            name: spec.title,
            artist: spec.artist || "",
            cover: spec.cover || "",
            url: "",
            lrc: "",
            key: "snapshot:" + spec.id,
          });
        }
      }
      if (spec.server === "qqvip" && spec.title) {
        // QQ 展示快照已经包含封面、歌名和歌手；播放地址涉及登录态，
        // 延迟到用户真正点击时再请求，避免首屏为每张卡片发起 VIP 接口调用。
        tracks = [{ name: spec.title, artist: spec.artist || "", cover: spec.cover || "", url: "", lrc: "", key: `qqvip:${spec.id}` }];
      }

      const data: CardMusicState = { tracks, lyrics: new Map(), loading: new Set(), activeIndex: 0, gesture: null, swipeFrame: null, suppressClick: false, playAfterResolve: false, spec, metadataPromise: null, resolvePromise: null };
      if (!el.isConnected) return;
      cardMusicState.set(card, data);
      if (tracks.length > 0) {
        renderCardTrack(card, data, 0);
        const swipeCleanup = bindCardSwipe(card, data);
        if (swipeCleanup) cardSwipeCleanups.set(card, swipeCleanup);
        card.classList.add("is-ready");
        card.setAttribute("aria-busy", "false");
      } else {
        card.classList.add("is-pending");
      }
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
        if (!activeTrack || !activeTrack.url) {
          data.playAfterResolve = true;
          const promise = resolveTracks(card, data);
          void promise.then((resolved) => {
            if (!data.playAfterResolve) return;
            data.playAfterResolve = false;
            const resolvedTrack = resolved[data.activeIndex] ?? resolved[0];
            if (resolvedTrack) requestGlobalPlay({ tracks: resolved, cardId: card.dataset.cardId, trackKey: trackKey(resolvedTrack) });
          }).catch(() => {
            data.playAfterResolve = false;
          });
          return;
        }
        requestGlobalPlay({ tracks: data.tracks, cardId: card.dataset.cardId, trackKey: trackKey(activeTrack) });
      });
      const retryButton = card.querySelector<HTMLButtonElement>(".music-trigger-retry");
      retryButton?.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        data.playAfterResolve = false;
        void resolveTracks(card, data).catch(() => undefined);
      });
      metadataObserver?.observe(card);
    }

    const metadataObserver = typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver((entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const card = entry.target as HTMLElement;
            metadataObserver?.unobserve(card);
            const data = cardMusicState.get(card);
            if (!data || data.metadataPromise || data.tracks[0]?.name) return;
            void resolveMetadata(card, data);
          });
        }, { rootMargin: "320px 0px", threshold: 0.01 });

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

    const contentRoot = document.querySelector("main") ?? document.body;
    const onMusicHydrated = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.classList.contains("blog-music")) scan(target);
    };
    contentRoot.addEventListener("yezi:music-hydrated", onMusicHydrated);
    scan(contentRoot);
    const cleanupDisconnectedCards = () => {
      for (const [card, cleanup] of cardSwipeCleanups) {
        if (!card.isConnected) {
          cleanup();
          cardSwipeCleanups.delete(card);
        }
      }
    };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) scan(node);
        });
      }
      cleanupDisconnectedCards();
    });
    observer.observe(contentRoot, { childList: true, subtree: true });

    // 播放器的 timeupdate 频率较高，合并到下一帧，避免每次进度事件都遍历长页面。
    let stateSyncFrame: number | null = null;
    const unsubscribeState = setGlobalStateListener(() => {
      if (stateSyncFrame !== null) return;
      stateSyncFrame = requestAnimationFrame(() => {
        stateSyncFrame = null;
        const state = getGlobalPlaybackState();
        contentRoot.querySelectorAll<HTMLElement>(".music-trigger").forEach((card) => syncCard(card, state));
      });
    });

    return () => {
      contentRoot.removeEventListener("yezi:music-hydrated", onMusicHydrated);
      observer.disconnect();
      metadataObserver?.disconnect();
      unsubscribeState();
      if (stateSyncFrame !== null) cancelAnimationFrame(stateSyncFrame);
      cardSwipeCleanups.forEach((cleanup) => cleanup());
      cardSwipeCleanups.clear();
    };
  }, []);

  return null;
}
