"use client";

import { useEffect, useRef } from "react";
import { buildMetingUrl, type MusicSpec } from "@/lib/music";

interface MetingTrack {
  name?: string;
  url?: string;
  artist?: string;
  cover?: string;
  lrc?: string;
}

type APlayerInstance = { destroy: () => void };

/**
 * 全站音乐播放器初始化器。
 *
 * 扫描页面（及 SPA 导航后新增）的 `.blog-music` 容器，按需动态加载 APlayer，
 * 调 Meting API 取音频后 `new APlayer`。容器移除时自动 destroy。
 * 挂在 SiteLayoutInner 上，文章与想法均可触发。
 */
export function MusicInitializer({ metingApi }: { metingApi: string }) {
  const apiRef = useRef(metingApi);
  useEffect(() => {
    apiRef.current = metingApi;
  }, [metingApi]);

  const instancesRef = useRef<Map<HTMLElement, APlayerInstance>>(new Map());
  const aplayerPromiseRef = useRef<Promise<typeof import("aplayer")> | null>(null);

  useEffect(() => {
    async function loadAplayer() {
      if (!aplayerPromiseRef.current) {
        aplayerPromiseRef.current = import("aplayer");
      }
      return aplayerPromiseRef.current;
    }

    async function initContainer(el: HTMLElement) {
      if (el.dataset.init === "1") return;
      const server = el.dataset.server;
      const id = el.dataset.id;
      const type = el.dataset.type;
      if (!server || !id || !type) return;
      el.dataset.init = "1";
      const spec = { server, id, type } as MusicSpec;
      try {
        const mod = await loadAplayer();
        const APlayer = mod.default;
        // 15s 超时：Meting API 挂起时给出错误占位而不是永久空白
        const res = await fetch(buildMetingUrl(apiRef.current, spec), { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`meting ${res.status}`);
        const data = (await res.json()) as MetingTrack[] | null;
        const audio = (Array.isArray(data) ? data : [])
          .filter((track) => track && typeof track.url === "string" && track.url.length > 0)
          .map((track) => ({
            name: track.name || "未知曲目",
            artist: track.artist || "",
            url: track.url as string,
            cover: track.cover || "",
            lrc: track.lrc || "",
          }));
        if (audio.length === 0) throw new Error("no audio");
        // 播放器主题色跟随站点当前配色方案（CSS 变量），切主题后新播放器自动匹配
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c25f3d";
        const player = new APlayer({
          container: el,
          audio,
          listFolded: false,
          autoplay: false,
          order: "list",
          loop: "all",
          theme: accent,
        });
        instancesRef.current.set(el, player);
      } catch {
        el.innerHTML = '<p class="blog-music-error">音乐暂不可用（版权或接口异常）</p>';
      }
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

    function destroyIn(node: HTMLElement) {
      const player = instancesRef.current.get(node);
      if (player) {
        try { player.destroy(); } catch { /* noop */ }
        instancesRef.current.delete(node);
      }
      node.querySelectorAll?.(".blog-music").forEach((child) => {
        const inner = instancesRef.current.get(child as HTMLElement);
        if (inner) {
          try { inner.destroy(); } catch { /* noop */ }
          instancesRef.current.delete(child as HTMLElement);
        }
      });
    }

    scan(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1) scan(node);
        });
        mutation.removedNodes.forEach((node) => {
          if (node.nodeType === 1 && node instanceof HTMLElement) destroyIn(node);
        });
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const instances = instancesRef.current;
    return () => {
      observer.disconnect();
      instances.forEach((player) => {
        try { player.destroy(); } catch { /* noop */ }
      });
      instances.clear();
    };
  }, []);

  return null;
}
