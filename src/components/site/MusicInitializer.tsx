"use client";

import { useEffect, useRef } from "react";
import { fetchMusicTracks, type MusicSpec, type MusicTrack } from "@/lib/music";
import { getGlobalPlaybackState, requestGlobalPlay, setGlobalStateListener } from "@/lib/player-store";
import { lyricAt, parseLrc, type LyricLine } from "@/lib/lyrics";

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
    };
    const cardMusicState = new WeakMap<HTMLElement, CardMusicState>();

    function trackKey(track: MusicTrack): string {
      return track.key?.trim() || track.url.trim() || `${track.name}\u0000${track.artist}`;
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
      const track = hasTrackKey(state.trackKey, data.tracks) ? data.tracks.find((item) => trackKey(item) === state.trackKey) : data.tracks[0];
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
      const titleEl = card.querySelector<HTMLElement>(".music-trigger-name");
      const data = cardMusicState.get(card);
      if (!titleEl || !data || data.tracks.length === 0) return;
      const isCurrentCard = Boolean(card.dataset.cardId) && state.cardId === card.dataset.cardId;
      const currentTrack = isCurrentCard && hasTrackKey(state.trackKey, data.tracks)
        ? data.tracks.find((item) => trackKey(item) === state.trackKey) ?? data.tracks[0]
        : data.tracks[0];
      titleEl.textContent = data.tracks.length === 1
        ? currentTrack.name
        : `${currentTrack.name} 等 ${data.tracks.length} 首`;
    }

    function syncCard(card: HTMLElement, state: ReturnType<typeof getGlobalPlaybackState>): void {
      syncCardTitle(card, state);
      syncCardState(card, state);
      syncCardLyric(card, state);
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
        <span class="music-trigger-cover"><img alt="" loading="lazy" /></span>
        <span class="music-trigger-info">
          <span class="music-trigger-name">音乐加载中…</span>
          <span class="music-trigger-artist">
            <span class="music-trigger-artist-name"></span>
            <span class="music-trigger-lyric" aria-live="polite"><span class="music-trigger-lyric-text"></span></span>
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

      const first = tracks[0];
      const img = card.querySelector("img")!;
      const cover = card.querySelector<HTMLElement>(".music-trigger-cover")!;
      if (first.cover) {
        img.addEventListener("error", () => {
          img.removeAttribute("src");
          cover.classList.add("is-fallback");
        }, { once: true });
        img.src = first.cover;
      } else {
        cover.classList.add("is-fallback");
      }
      card.querySelector(".music-trigger-name")!.textContent =
        tracks.length === 1 ? first.name : `${first.name} 等 ${tracks.length} 首`;
      card.querySelector(".music-trigger-artist-name")!.textContent = first.artist || "";
      cardMusicState.set(card, { tracks, lyrics: new Map(), loading: new Set() });
      card.classList.add("is-ready");
      // 新卡片同步一次当前播放状态（可能是正在播放的这张卡）
      syncCard(card, getGlobalPlaybackState());

      // 点击整张卡片：追加到全局播放器并播放（曲目已拉取，直接复用）。
      card.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestGlobalPlay({ tracks, cardId: card.dataset.cardId });
      });
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
    };
  }, []);

  return null;
}
