"use client";

import { useEffect, useRef } from "react";
import { fetchMusicTracks, type MusicSpec, type MusicTrack } from "@/lib/music";
import { requestGlobalPlay } from "@/lib/player-store";

/**
 * 全站音乐触发卡片初始化器。
 *
 * 全局唯一 APlayer 由 GlobalMusicPlayer 常驻在布局持久层管理（保证站内导航不中断播放）。
 * 本组件只负责把文章/想法里的 `.blog-music` 容器渲染成可点击的"触发卡片"
 * （封面 + 歌名 + 播放按钮），点击后把曲目追加到全局播放器列表末尾并播放。
 *
 * 扫描页面（及 SPA 导航后新增）的 `.blog-music` 容器，异步拉 Meting 数据填充卡片。
 * 挂在 SiteLayoutInner 上，文章与想法均可触发。
 */
export function MusicInitializer({ metingApi }: { metingApi: string }) {
  const apiRef = useRef(metingApi);
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
      if (first.cover) img.src = first.cover;
      card.querySelector(".music-trigger-name")!.textContent =
        tracks.length === 1 ? first.name : `${first.name} 等 ${tracks.length} 首`;
      card.querySelector(".music-trigger-artist")!.textContent = first.artist || "";
      card.classList.add("is-ready");

      // 点击整张卡片：追加到全局播放器并播放（曲目已拉取，直接复用）。
      card.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        requestGlobalPlay({ tracks });
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

    return () => observer.disconnect();
  }, []);

  return null;
}
