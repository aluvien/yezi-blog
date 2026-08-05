"use client";

import { useEffect, useRef } from "react";
import { fetchMusicTracks, type MusicSpec, type MusicTrack } from "@/lib/music";
import { getGlobalPlaybackState, requestGlobalPlay, setGlobalStateListener } from "@/lib/player-store";

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
 * （封面 + 歌名 + 播放按钮），点击后把曲目追加到全局播放器列表末尾并播放；
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
    async function initContainer(el: HTMLElement) {
      if (el.dataset.init === "1") return;
      const server = el.dataset.server;
      const id = el.dataset.id;
      const type = el.dataset.type;
      if (!server || !id || !type) return;
      el.dataset.init = "1";
      const spec = { server, id, type } as MusicSpec;

      const card = document.createElement("div");
      card.className = "music-trigger";
      card.dataset.cardId = String(cardSeqRef.current++);
      card.innerHTML = `
        <span class="music-trigger-cover"><img alt="" loading="lazy" /></span>
        <span class="music-trigger-info">
          <span class="music-trigger-name">音乐加载中…</span>
          <span class="music-trigger-artist"></span>
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
      card.querySelector(".music-trigger-artist")!.textContent = first.artist || "";
      card.classList.add("is-ready");
      // 新卡片同步一次当前播放状态（可能是正在播放的这张卡）
      syncCardState(card, getGlobalPlaybackState());

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
      document.querySelectorAll<HTMLElement>(".music-trigger").forEach((card) => syncCardState(card, state));
    });

    return () => {
      observer.disconnect();
      unsubscribeState();
    };
  }, []);

  return null;
}
