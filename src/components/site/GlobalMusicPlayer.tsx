"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { fetchMusicTracks, parseMusicSpec, type MusicTrack } from "@/lib/music";
import { emitGlobalPlaybackState, setGlobalPlayListener } from "@/lib/player-store";

type APlayerInstance = import("aplayer").default;

type PanelDragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  moved: boolean;
  blocked: boolean;
};

const PANEL_DISMISS_DISTANCE = 64;
const PANEL_DISMISS_FLICK_DISTANCE = 24;
const PANEL_DISMISS_FLICK_VELOCITY = 0.55;

function focusedBlogVideoFrame(): HTMLIFrameElement | null {
  const active = document.activeElement;
  return active instanceof HTMLIFrameElement && active.matches(".blog-video iframe") ? active : null;
}

function pauseYouTubeFrame(frame: HTMLIFrameElement): void {
  try {
    const targetOrigin = new URL(frame.src).origin;
    frame.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
      targetOrigin,
    );
  } catch {
    // iframe 已卸载或 URL 无效时无需影响音乐播放。
  }
}

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
  const [defaultMusicError, setDefaultMusicError] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentTrack, setCurrentTrack] = useState<MusicTrack | null>(null);
  const [panelDragOffset, setPanelDragOffset] = useState(0);
  const [panelDragging, setPanelDragging] = useState(false);
  const [collapseHintVisible, setCollapseHintVisible] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef(metingApi);
  const playerRef = useRef<APlayerInstance | null>(null);
  const currentTrackRef = useRef<MusicTrack | null>(null);
  const panelDragRef = useRef<PanelDragState | null>(null);
  const suppressPanelClickUntilRef = useRef(0);
  const collapseHintTimerRef = useRef<number | null>(null);
  const activeVideoFrameRef = useRef<HTMLIFrameElement | null>(null);
  // 默认歌单未就绪前的页面点选先入队，默认列表加载完成后再追加，保证其始终位于队列前部。
  const readyRef = useRef(false);
  const pendingRef = useRef<Array<{ tracks: MusicTrack[]; cardId?: string | null; trackKey?: string | null }>>([]);
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

  useEffect(
    () => () => {
      if (collapseHintTimerRef.current !== null) window.clearTimeout(collapseHintTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    let captureTimer: number | null = null;
    const captureFocusedVideo = () => {
      if (captureTimer !== null) window.clearTimeout(captureTimer);
      captureTimer = window.setTimeout(() => {
        captureTimer = null;
        const frame = focusedBlogVideoFrame();
        if (frame) activeVideoFrameRef.current = frame;
      }, 0);
    };
    // 点击跨域 iframe 时事件不会冒泡到父页面，但父窗口会失焦，借此记录刚交互的视频。
    window.addEventListener("blur", captureFocusedVideo);
    document.addEventListener("focusin", captureFocusedVideo, true);
    return () => {
      window.removeEventListener("blur", captureFocusedVideo);
      document.removeEventListener("focusin", captureFocusedVideo, true);
      if (captureTimer !== null) window.clearTimeout(captureTimer);
    };
  }, []);

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

    function pauseCompetingMedia(player: APlayerInstance): void {
      // 同源原生媒体可以直接暂停；APlayer 的 audio 未挂到 DOM，但仍显式排除以便后续实现变化。
      document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
        if (media !== player.audio && !media.paused) media.pause();
      });

      document.querySelectorAll<HTMLIFrameElement>('.blog-video iframe[data-video-platform="youtube"]').forEach(pauseYouTubeFrame);

      const activeFrame = activeVideoFrameRef.current;
      if (!activeFrame?.isConnected) {
        activeVideoFrameRef.current = null;
        return;
      }
      if (activeFrame.dataset.videoPlatform === "bilibili") {
        // Bilibili 外链 iframe 没有父页面可调用的暂停 API；仅重载刚交互的实例来停止其媒体，
        // 不刷新其他未播放的视频，也不影响当前文章位置。
        activeFrame.src = activeFrame.src;
      }
      activeVideoFrameRef.current = null;
    }

    function decoratePlayerChrome(player: APlayerInstance): void {
      const host = hostRef.current;
      const track = player.list.audios[player.list.index];
      if (!host || !track) return;

      const title = host.querySelector<HTMLElement>(".aplayer-title");
      const author = host.querySelector<HTMLElement>(".aplayer-author");
      if (title) title.textContent = track.name;
      if (author) author.textContent = track.artist?.trim() || "未知歌手";

      const music = host.querySelector<HTMLElement>(".aplayer-music");
      const time = host.querySelector<HTMLElement>(".aplayer-time-inner");
      if (music && title && time) {
        time.childNodes.forEach((node) => {
          if (node.nodeType === 3 && node.textContent?.includes("/")) node.textContent = "/";
        });
        let heading = music.querySelector<HTMLElement>(".global-player-track-heading");
        if (!heading) {
          heading = document.createElement("span");
          heading.className = "global-player-track-heading";
          music.insertBefore(heading, title);
        }
        if (title.parentElement !== heading) heading.append(title);
        if (time.parentElement !== heading) heading.append(time);
      }

      const list = host.querySelector<HTMLElement>(".aplayer-list");
      const randomOrder = player.options.order === "random";
      const listOpen = Boolean(list && !list.classList.contains("aplayer-list-hide"));
      host.classList.toggle("is-random-order", randomOrder);
      host.classList.toggle("is-list-open", listOpen);
      host.classList.toggle("is-playing", !player.paused);

      const controls: Array<[string, string]> = [
        [".aplayer-icon-back", "上一首"],
        [".aplayer-icon-play", player.paused ? "播放" : "暂停"],
        [".aplayer-icon-forward", "下一首"],
        [".aplayer-icon-volume-down", "音量"],
        [".aplayer-icon-order", randomOrder ? "随机播放已开启" : "开启随机播放"],
        [".aplayer-icon-loop", "循环模式"],
        [".aplayer-icon-menu", listOpen ? "收起待播放列表" : "展开待播放列表"],
        [".aplayer-icon-lrc", "显示或隐藏歌词"],
      ];
      controls.forEach(([selector, label]) => {
        const control = host.querySelector<HTMLElement>(selector);
        if (!control) return;
        control.setAttribute("aria-label", label);
        control.setAttribute("title", label);
        if (control.tagName !== "BUTTON") {
          control.setAttribute("role", "button");
          control.tabIndex = 0;
          if (control.dataset.keyboardControl !== "1") {
            control.dataset.keyboardControl = "1";
            control.addEventListener("keydown", (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              control.click();
            });
          }
        }
        if ((selector === ".aplayer-icon-order" || selector === ".aplayer-icon-menu") && control.dataset.chromeSync !== "1") {
          control.dataset.chromeSync = "1";
          control.addEventListener("click", () => queueMicrotask(() => decoratePlayerChrome(player)));
        }
      });

      const orderControl = host.querySelector<HTMLElement>(".aplayer-icon-order");
      const menuControl = host.querySelector<HTMLElement>(".aplayer-icon-menu");
      orderControl?.setAttribute("aria-pressed", String(randomOrder));
      menuControl?.setAttribute("aria-expanded", String(listOpen));

      host.querySelectorAll<HTMLLIElement>(".aplayer-list ol li").forEach((item, index) => {
        if (index === player.list.index) item.setAttribute("aria-current", "true");
        else item.removeAttribute("aria-current");
      });
    }

    function decoratePlayerList(player: APlayerInstance): void {
      const items = hostRef.current?.querySelectorAll<HTMLLIElement>(".aplayer-list ol li");
      if (!items) return;
      items.forEach((item, index) => {
        const track = player.list.audios[index];
        if (!track) return;
        let cover = item.querySelector<HTMLElement>(".global-player-list-cover");
        if (!cover) {
          cover = document.createElement("span");
          cover.className = "global-player-list-cover";
          cover.setAttribute("aria-hidden", "true");
          item.prepend(cover);
        }
        cover.textContent = track.cover ? "" : "♫";
        cover.style.backgroundImage = track.cover ? `url("${track.cover.replaceAll('"', "%22")}")` : "none";
        item.dataset.trackKey = trackKey(track);
      });
      decoratePlayerChrome(player);
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
        decoratePlayerList(player);
        setHasTracks(true);
        if (!currentTrackRef.current) updateCurrentTrack(uniqueTracks[0]);
      }
    }

    function appendAndPlay(tracks: MusicTrack[], cardId: string | null, preferredTrackKey: string | null = null) {
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
          if (preferredTrackKey && key === preferredTrackKey) targetIndex = existingIndex;
          else if (targetIndex === null) targetIndex = existingIndex;
          continue;
        }
        const index = player.list.audios.length + uniqueTracks.length;
        trackIndex.set(key, index);
        ownerMap.set(index, cardId);
        uniqueTracks.push(track);
        if (preferredTrackKey && key === preferredTrackKey) targetIndex = index;
        else if (targetIndex === null) targetIndex = index;
      }
      if (uniqueTracks.length > 0) {
        player.list.add(uniqueTracks);
        decoratePlayerList(player);
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

    function toggleOrAppendAndPlay(tracks: MusicTrack[], cardId: string | null, preferredTrackKey: string | null = null) {
      const player = playerRef.current;
      if (!player || tracks.length === 0) return;
      // 同一张文章音乐卡片再次点击时只切换暂停/继续，不重新切回第一首。
      const currentAudio = player.list.index >= 0 ? player.list.audios[player.list.index] : null;
      const currentKey = currentAudio ? trackKey(currentAudio) : null;
      const shouldToggle = cardId !== null && currentCardIdRef.current === cardId && (!preferredTrackKey || currentKey === preferredTrackKey);
      if (shouldToggle) {
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
      appendAndPlay(tracks, cardId, preferredTrackKey);
    }

    async function boot() {
      try {
        const mod = await import("aplayer");
        if (disposed || !hostRef.current) return;
        const APlayer = mod.default;
        const parsedDefaultSpec = parseMusicSpec(defaultMusic);
        const defaultSpec = parsedDefaultSpec
          ? { ...parsedDefaultSpec, shuffle: parsedDefaultSpec.shuffle || defaultMusicShuffle }
          : null;
        const defaultRandom = Boolean(defaultSpec && defaultSpec.type !== "song" && defaultSpec.shuffle);
        const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#c25f3d";
        const player = new APlayer({
          container: hostRef.current,
          audio: [],
          listFolded: false,
          // Meting 的 lrc 字段是歌词地址，APlayer 的异步歌词模式会读取并滚动显示它。
          lrcType: 3,
          autoplay: false,
          order: defaultRandom ? "random" : "list",
          loop: "all",
          theme: accent,
        });
        playerRef.current = player;
        player.on("play", () => {
          pauseCompetingMedia(player);
          setPlaying(true);
          decoratePlayerChrome(player);
          emitPlayerState(player, true, currentCardIdRef.current);
        });
        player.on("pause", () => {
          window.setTimeout(() => {
            const frame = focusedBlogVideoFrame();
            if (frame) activeVideoFrameRef.current = frame;
          }, 0);
          setPlaying(false);
          decoratePlayerChrome(player);
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
          // APlayer 在触发 listswitch 后才更新标题、歌手和高亮，放到微任务中统一修正展示。
          queueMicrotask(() => decoratePlayerChrome(player));
        });

        // 默认歌单：后台设置 default_music，加载失败静默（不影响页面点选音乐）。
        if (defaultSpec) {
          try {
            const tracks = await fetchMusicTracks(apiRef.current, defaultSpec);
            if (disposed) return;
            addUniqueTracks(tracks, null);
            setDefaultMusicError("");
          } catch (error) {
            if (!disposed) setDefaultMusicError(error instanceof Error ? error.message : "默认歌单加载失败");
          }
        }
      } catch {
        // APlayer 初始化异常时降级为"仅静默"：播放器不可用但页面不受影响。
        if (disposed) return;
      }
      readyRef.current = true;
      for (const batch of pendingRef.current) appendAndPlay(batch.tracks, batch.cardId ?? null, batch.trackKey ?? null);
      pendingRef.current = [];
    }

    let bootPromise: Promise<void> | null = null;
    const ensureBoot = (): void => {
      if (bootPromise) return;
      bootPromise = boot();
    };

    unlisten = setGlobalPlayListener(({ tracks, cardId, trackKey: preferredTrackKey }) => {
      ensureBoot();
      if (!readyRef.current) {
        pendingRef.current.push({ tracks, cardId, trackKey: preferredTrackKey });
        return;
      }
      toggleOrAppendAndPlay(tracks, cardId ?? null, preferredTrackKey ?? null);
    });
    // 没有默认歌单时延迟加载 APlayer，访客没有点击音乐就不需要下载播放器。
    if (parseMusicSpec(defaultMusic)) ensureBoot();

    return () => {
      disposed = true;
      unlisten?.();
      try {
        playerRef.current?.destroy();
      } catch {
        /* noop */
      }
      playerRef.current = null;
      readyRef.current = false;
      pendingRef.current = [];
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
    if (collapseHintTimerRef.current !== null) window.clearTimeout(collapseHintTimerRef.current);
    collapseHintTimerRef.current = null;
    setCollapseHintVisible(false);
    panelDragRef.current = null;
    setPanelDragging(false);
    setPanelDragOffset(0);
    setOpen(false);
  }

  function revealCollapseHint(): void {
    if (playerPosition === "bottom") return;
    setCollapseHintVisible(true);
    if (collapseHintTimerRef.current !== null) window.clearTimeout(collapseHintTimerRef.current);
    collapseHintTimerRef.current = window.setTimeout(() => {
      collapseHintTimerRef.current = null;
      setCollapseHintVisible(false);
    }, 2000);
  }

  function startPanelDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!panelOpen || playerPosition === "bottom" || !event.isPrimary || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    const collapseHandle = target?.closest(".global-player-collapse");
    const playerBody = target?.closest(".aplayer-body");
    // 列表和播放控件必须保留完整的原生点击/滚动事件，父级既不更新状态也不捕获指针。
    // 下滑收起只由顶部把手，以及控制卡片内的封面、歌名等非交互区域触发。
    if (!collapseHandle && !playerBody) return;
    if (
      !collapseHandle &&
      target?.closest(".aplayer-controller, .aplayer-icon, button, a, input, select, textarea, [role='button']")
    ) {
      return;
    }
    revealCollapseHint();
    panelDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      moved: false,
      blocked: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePanelDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.blocked) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.max(10, Math.abs(deltaY) * 1.15)) {
      drag.blocked = true;
      return;
    }
    if (deltaY <= 4) return;
    drag.moved = true;
    setPanelDragging(true);
    setPanelDragOffset(Math.min(deltaY, 260));
    event.preventDefault();
  }

  function finishPanelDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = Math.max(0, event.clientY - drag.startY);
    const elapsed = Math.max(1, performance.now() - drag.startedAt);
    const velocity = distance / elapsed;
    const shouldDismiss =
      !drag.blocked &&
      (distance >= PANEL_DISMISS_DISTANCE ||
        (distance >= PANEL_DISMISS_FLICK_DISTANCE && velocity >= PANEL_DISMISS_FLICK_VELOCITY));

    if (drag.moved) suppressPanelClickUntilRef.current = Date.now() + 350;
    panelDragRef.current = null;
    setPanelDragging(false);
    if (shouldDismiss) minimizePlayer();
    else setPanelDragOffset(0);
  }

  function cancelPanelDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if (panelDragRef.current?.pointerId !== event.pointerId) return;
    panelDragRef.current = null;
    setPanelDragging(false);
    setPanelDragOffset(0);
  }

  function suppressClickAfterPanelDrag(event: ReactMouseEvent<HTMLDivElement>): void {
    if (Date.now() >= suppressPanelClickUntilRef.current) return;
    event.preventDefault();
    event.stopPropagation();
  }

  const panelStyle = { "--player-drag-y": `${panelDragOffset}px` } as CSSProperties;

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
            <>
              {/* QQ/网易云封面是运行时外部 URL，无法交给 Next Image 的本地静态追踪。 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="global-player-float-cover" src={currentTrack.cover} alt="" />
            </>
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
      <div
        className={`global-player-panel ${panelOpen ? "is-open" : ""} ${panelDragging ? "is-dragging" : ""} ${collapseHintVisible ? "show-collapse" : ""}`}
        style={panelStyle}
        role="region"
        aria-label="音乐播放器"
        onPointerDown={startPanelDrag}
        onPointerMove={movePanelDrag}
        onPointerUp={finishPanelDrag}
        onPointerCancel={cancelPanelDrag}
        onClickCapture={suppressClickAfterPanelDrag}
      >
        {open && playerPosition !== "bottom" && (
          <button type="button" className="global-player-collapse" aria-label="最小化播放器" title="最小化播放器" onClick={minimizePlayer}>
            <span className="global-player-collapse-handle" aria-hidden="true" />
          </button>
        )}
        <div className="global-player-host">
          <div ref={hostRef} className={`aplayer-host ${defaultMusicError && !hasTracks ? "hidden" : ""}`} />
          {defaultMusicError && !hasTracks && (
            <div className="px-4 py-4 text-sm text-muted" role="alert">
              <p className="font-medium text-foreground">默认歌单暂时无法播放</p>
              <p className="mt-1 text-xs leading-5">{defaultMusicError}</p>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
