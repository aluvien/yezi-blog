"use client";

import { useEffect, useRef, useState } from "react";
import { fetchMusicTracks, parseMusicSpec, type MusicTrack } from "@/lib/music";
import { emitGlobalPlaybackState, setGlobalPlayListener } from "@/lib/player-store";

type APlayerInstance = import("aplayer").default;

/**
 * 全局音乐播放器（右下角悬浮球 + 底部控制面板）。
 *
 * 全站唯一的 APlayer 实例常驻在此组件，挂在 SiteLayoutInner 的布局持久层
 * （`{children}` 之外），站内客户端导航时组件不卸载，音乐因此跨页面连续播放。
 * - 默认列表：后台设置 `default_music`（形如 `netease:xxx:playlist`），加载后作为基础列表；可单独开启随机顺序。
 * - 页面音乐：MusicInitializer 的触发卡片经 player-store 请求"追加并播放"，
 *   新曲目追加到列表末尾并立即播放，默认列表不受影响。
 * - 底部面板始终渲染（闭合时 transform 移出屏幕而非 display:none），
 *   避免 display:none 导致 APlayer 布局/音频异常。
 */
export function GlobalMusicPlayer({
  metingApi,
  defaultMusic = "",
  defaultMusicShuffle = false,
  musicFloatEnabled = true,
  musicPosition = "left",
}: {
  metingApi: string;
  defaultMusic?: string;
  defaultMusicShuffle?: boolean;
  musicFloatEnabled?: boolean;
  musicPosition?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hasTracks, setHasTracks] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef(metingApi);
  const playerRef = useRef<APlayerInstance | null>(null);
  const currentTrackRef = useRef<MusicTrack | null>(null);
  // 默认歌单未就绪前的页面点选先入队，默认列表加载完成后再追加，保证其始终位于队列前部。
  const readyRef = useRef(false);
  const pendingRef = useRef<Array<{ tracks: MusicTrack[]; cardId?: string | null }>>([]);
  // 当前正在播放的触发卡片 id + 播放列表各 index 归属的卡片 id（用于面板内切歌时回显）
  const currentCardIdRef = useRef<string | null>(null);
  const ownerMapRef = useRef(new Map<number, string | null>());
  const trackIndexRef = useRef(new Map<string, number>());
  const hasDefaultPlaylist = Boolean(parseMusicSpec(defaultMusic));
  const playerPosition = musicPosition === "right" || musicPosition === "bottom" ? musicPosition : "left";
  const shouldShowPlayer = hasTracks || hasDefaultPlaylist;
  const panelOpen = shouldShowPlayer && (open || playerPosition === "bottom");

  useEffect(() => {
    apiRef.current = metingApi;
  }, [metingApi]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;
    // ref 在 effect 生命周期内不会变，取局部引用避免 effect cleanup 依赖过期的 ref 读取
    const ownerMap = ownerMapRef.current;
    const trackIndex = trackIndexRef.current;
    const trackMap = new Map<string, MusicTrack>();

    function updateCurrentTrack(track: MusicTrack | null): void {
      currentTrackRef.current = track;
      setCurrentTrack(track);
    }

    function trackKey(track: { key?: string; url: string; name: string; artist?: string }): string {
      return track.key?.trim() || track.url.trim() || `${track.name}\u0000${track.artist ?? ""}`;
    }

    function emitPlayerState(player: APlayerInstance, playing: boolean, cardId: string | null, index = player.list.index): void {
      const track = player.list.audios[index];
      const normalizedTrack = track ? trackMap.get(trackKey(track)) ?? null : null;
      if (normalizedTrack) updateCurrentTrack(normalizedTrack);
      emitGlobalPlaybackState({
        playing,
        cardId,
        trackKey: track ? trackKey(track) : null,
        currentTime: Number.isFinite(player.audio.currentTime) ? player.audio.currentTime : 0,
      });
    }

    function addUniqueTracks(tracks: MusicTrack[], owner: string | null): void {
      const player = playerRef.current;
      if (!player || tracks.length === 0) return;
      const uniqueTracks: MusicTrack[] = [];
      for (const track of tracks) {
        const key = trackKey(track);
        trackMap.set(key, track);
        const existingIndex = trackIndex.get(key);
        if (existingIndex !== undefined) {
          ownerMap.set(existingIndex, owner);
          continue;
        }
        const index = player.list.audios.length + uniqueTracks.length;
        trackIndex.set(key, index);
        ownerMap.set(index, owner);
        uniqueTracks.push(track);
      }
      if (uniqueTracks.length > 0) {
        player.list.add(uniqueTracks);
        setHasTracks(true);
        if (!currentTrackRef.current) updateCurrentTrack(uniqueTracks[0]);
      }
    }

    function appendAndPlay(tracks: MusicTrack[], cardId: string | null) {
      const player = playerRef.current;
      if (!player || tracks.length === 0) return;
      currentCardIdRef.current = cardId;
      let targetIndex: number | null = null;
      const uniqueTracks: MusicTrack[] = [];
      for (const track of tracks) {
        const key = trackKey(track);
        trackMap.set(key, track);
        const existingIndex = trackIndex.get(key);
        if (existingIndex !== undefined) {
          ownerMap.set(existingIndex, cardId);
          if (targetIndex === null) targetIndex = existingIndex;
          continue;
        }
        const index = player.list.audios.length + uniqueTracks.length;
        trackIndex.set(key, index);
        ownerMap.set(index, cardId);
        uniqueTracks.push(track);
        if (targetIndex === null) targetIndex = index;
      }
      if (uniqueTracks.length > 0) {
        player.list.add(uniqueTracks);
        setHasTracks(true);
      }
      if (targetIndex === null) return;
      try {
        player.list.switch(targetIndex);
      } catch {
        // APlayer 对空列表 switch 可能抛错，忽略即可
      }
      player.play();
      setHasTracks(true);
      setPlaying(true);
      emitPlayerState(player, true, cardId, targetIndex);
    }

    function toggleOrAppendAndPlay(tracks: MusicTrack[], cardId: string | null) {
      const player = playerRef.current;
      if (!player || tracks.length === 0) return;
      // 同一张文章音乐卡片再次点击时只切换暂停/继续，不重新切回第一首。
      if (cardId !== null && currentCardIdRef.current === cardId) {
        if (player.paused) {
          player.play();
          setHasTracks(true);
          setPlaying(true);
          emitPlayerState(player, true, cardId);
        } else {
          player.pause();
        }
        return;
      }
      appendAndPlay(tracks, cardId);
    }

    async function boot() {
      try {
        const mod = await import("aplayer");
        if (disposed || !hostRef.current) return;
        const APlayer = mod.default;
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c25f3d";
        const player = new APlayer({
          container: hostRef.current,
          audio: [],
          listFolded: false,
          // Meting 的 lrc 字段是歌词地址，APlayer 的异步歌词模式会读取并滚动显示它。
          lrcType: 3,
          autoplay: false,
          order: "list",
          loop: "all",
          theme: accent,
        });
        playerRef.current = player;
        player.on("play", () => {
          setPlaying(true);
          emitPlayerState(player, true, currentCardIdRef.current);
        });
        player.on("pause", () => {
          setPlaying(false);
          emitPlayerState(player, false, currentCardIdRef.current);
        });
        player.on("ended", () => {
          setPlaying(false);
          currentCardIdRef.current = null;
          emitPlayerState(player, false, null);
        });
        player.on("timeupdate", () => {
          emitPlayerState(player, !player.paused, currentCardIdRef.current);
        });
        // 面板内手动切歌：按当前 index 找到归属卡片，回显"正在播放"
        player.on("listswitch", (event) => {
          const index = typeof event?.index === "number" ? event.index : null;
          const cardId = index === null ? null : (ownerMap.get(index) ?? null);
          currentCardIdRef.current = cardId;
          emitPlayerState(player, !player.paused, cardId, index ?? player.list.index);
        });

        // 默认歌单：后台设置 default_music，加载失败静默（不影响页面点选音乐）。
        const parsedSpec = parseMusicSpec(defaultMusic);
        const spec = parsedSpec ? { ...parsedSpec, shuffle: parsedSpec.shuffle || defaultMusicShuffle } : null;
        if (spec) {
          try {
            const tracks = await fetchMusicTracks(apiRef.current, spec);
            if (disposed) return;
            addUniqueTracks(tracks, null);
          } catch {
            // noop
          }
        }
      } catch {
        // APlayer 初始化异常时降级为"仅静默"：播放器不可用但页面不受影响。
        if (disposed) return;
      }
      readyRef.current = true;
      for (const batch of pendingRef.current) appendAndPlay(batch.tracks, batch.cardId ?? null);
      pendingRef.current = [];
    }

    void boot();

    unlisten = setGlobalPlayListener(({ tracks, cardId }) => {
      if (!readyRef.current) {
        pendingRef.current.push({ tracks, cardId });
        return;
      }
      toggleOrAppendAndPlay(tracks, cardId ?? null);
    });

    return () => {
      disposed = true;
      unlisten?.();
      try {
        playerRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerRef.current = null;
      ownerMap.clear();
      trackIndex.clear();
      trackMap.clear();
      currentTrackRef.current = null;
      emitGlobalPlaybackState({ playing: false, cardId: null, trackKey: null, currentTime: 0 });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function minimizePlayer(): void {
    // 最小化只收起面板，不暂停或清空播放列表；音乐应继续在后台播放。
    setOpen(false);
  }

  return (
    <>
      {/* 没有后台默认歌单时，收起临时播放面板后隐藏悬浮球；有默认歌单则始终保留入口。 */}
      {musicFloatEnabled && playerPosition !== "bottom" && shouldShowPlayer && (
        <button
          type="button"
          className={`global-player-float ${open ? "is-open" : ""} ${playing ? "is-playing" : ""} ${playerPosition === "right" ? "is-right" : ""}`}
          aria-label={open ? "收起播放器" : currentTrack ? `${playing ? "正在播放" : "播放"}：${currentTrack.name}` : "展开播放器"}
          title={open ? "收起播放器" : currentTrack?.name || "展开播放器"}
          aria-expanded={panelOpen}
          onClick={() => setOpen((value) => !value)}
        >
          {currentTrack?.cover ? (
            <img className="global-player-float-cover" src={currentTrack.cover} alt="" />
          ) : (
            <span className="global-player-float-fallback" aria-hidden="true">
              <svg className="global-player-float-icon" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 18.5a2.5 2.5 0 1 1-2.5-2.5A2.5 2.5 0 0 1 9 18.5z" />
                <path d="M12.5 3.5v13.1a3.9 3.9 0 1 1-1.5-3.1V7.2l8-1.8v6.1a3.9 3.9 0 1 1-1.5-3.1V5.5l-5 1.1z" />
              </svg>
            </span>
          )}
        </button>
      )}

      {/* 底部面板：常驻 DOM，闭合时移出屏幕 */}
      <div className={`global-player-panel ${panelOpen ? "is-open" : ""}`} role="region" aria-label="音乐播放器">
        {open && playerPosition !== "bottom" && (
          <button type="button" className="global-player-collapse" aria-label="最小化播放器" title="最小化播放器" onClick={minimizePlayer}>
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
        <div className="global-player-host">
          <div ref={hostRef} className="aplayer-host" />
        </div>
      </div>
    </>
  );
}
