import type { MusicTrack } from "@/lib/music";

type MediaSessionPlayer = {
  audio: HTMLAudioElement;
  play(): void;
  pause(): void;
  skipBack(): void;
  skipForward(): void;
};

type PositionSource = Pick<HTMLMediaElement, "currentTime" | "duration" | "playbackRate">;

function currentMediaSession(): MediaSession | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return null;
  return navigator.mediaSession;
}

/** 生成系统 Now Playing 使用的稳定元数据；相对封面转换为绝对地址供 iOS 拉取。 */
export function createMediaSessionMetadata(track: MusicTrack, baseUrl: string): MediaMetadataInit {
  let artwork: MediaImage[] = [];
  const cover = track.cover.trim();
  if (cover) {
    try {
      artwork = [{ src: new URL(cover, baseUrl).href }];
    } catch {
      artwork = [];
    }
  }
  return {
    title: track.name.trim() || "未知歌曲",
    artist: track.artist.trim(),
    artwork,
  };
}

/** 仅在媒体时长有效时向系统报告进度，避免 Safari 因 NaN/Infinity 抛异常。 */
export function createMediaPositionState(source: PositionSource): MediaPositionState | null {
  const duration = Number(source.duration);
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const playbackRate = Number(source.playbackRate);
  const currentTime = Number(source.currentTime);
  return {
    duration,
    playbackRate: Number.isFinite(playbackRate) && playbackRate > 0 ? playbackRate : 1,
    position: Math.min(duration, Math.max(0, Number.isFinite(currentTime) ? currentTime : 0)),
  };
}

export function syncMediaSessionMetadata(track: MusicTrack): void {
  const session = currentMediaSession();
  if (!session || typeof MediaMetadata === "undefined" || typeof window === "undefined") return;
  try {
    session.metadata = new MediaMetadata(createMediaSessionMetadata(track, window.location.href));
  } catch {
    // 浏览器可能拒绝不支持的封面格式；网页播放器仍继续工作。
  }
}

export function syncMediaSessionPlayback(source: PositionSource, playing: boolean): void {
  const session = currentMediaSession();
  if (!session) return;
  try {
    session.playbackState = playing ? "playing" : "paused";
    const position = createMediaPositionState(source);
    if (position) session.setPositionState(position);
  } catch {
    // 旧版 Safari 可能只实现部分 Media Session API。
  }
}

function seek(player: MediaSessionPlayer, target: number): void {
  const duration = Number(player.audio.duration);
  const upper = Number.isFinite(duration) && duration > 0 ? duration : Number.MAX_SAFE_INTEGER;
  player.audio.currentTime = Math.min(upper, Math.max(0, target));
  syncMediaSessionPlayback(player.audio, !player.audio.paused);
}

/** 注册锁屏/控制中心动作；返回清理函数，组件卸载时移除旧播放器引用。 */
export function installMediaSessionActions(player: MediaSessionPlayer): () => void {
  const session = currentMediaSession();
  if (!session) return () => {};
  const installed: MediaSessionAction[] = [];
  const register = (action: MediaSessionAction, handler: MediaSessionActionHandler) => {
    try {
      session.setActionHandler(action, handler);
      installed.push(action);
    } catch {
      // WebKit 会对尚未实现的 action 抛 NotSupportedError，逐项忽略即可。
    }
  };

  register("play", () => player.play());
  register("pause", () => player.pause());
  register("previoustrack", () => player.skipBack());
  register("nexttrack", () => player.skipForward());
  register("seekto", (details) => {
    if (typeof details.seekTime !== "number") return;
    if (details.fastSeek && typeof player.audio.fastSeek === "function") {
      player.audio.fastSeek(details.seekTime);
      return;
    }
    seek(player, details.seekTime);
  });
  register("seekbackward", (details) => seek(player, player.audio.currentTime - (details.seekOffset ?? 10)));
  register("seekforward", (details) => seek(player, player.audio.currentTime + (details.seekOffset ?? 10)));
  register("stop", () => {
    player.pause();
    seek(player, 0);
  });

  return () => {
    installed.forEach((action) => {
      try {
        session.setActionHandler(action, null);
      } catch {
        // 会话已失效时无需继续清理。
      }
    });
  };
}

export function clearMediaSession(): void {
  const session = currentMediaSession();
  if (!session) return;
  try {
    session.metadata = null;
    session.playbackState = "none";
    session.setPositionState();
  } catch {
    // 部分实现不支持清空位置状态。
  }
}
