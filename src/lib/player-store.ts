import type { MusicTrack } from "@/lib/music";

export interface GlobalPlayPayload {
  /** 本次要追加到全局列表的曲目 */
  tracks: MusicTrack[];
  /** 触发卡片标识：全局播放器回显"正在播放"状态给对应卡片用 */
  cardId?: string | null;
  /** 列表卡片指定要播放的曲目标识；缺省时播放本次列表的第一首 */
  trackKey?: string | null;
}

export interface GlobalPlaybackState {
  playing: boolean;
  /** 当前正在播放的曲目所属触发卡片；来自默认歌单（非卡片触发）时为 null */
  cardId: string | null;
  /** 当前曲目的稳定标识，用于文章音乐卡片同步歌词。 */
  trackKey: string | null;
  /** 当前播放进度（秒），用于文章音乐卡片同步歌词。 */
  currentTime: number;
  /** 全局播放器实际使用的歌词地址；QQ 替代源时可能与文章原曲不同。 */
  lrc: string | null;
  /** APlayer 当前已解析并显示的歌词文本，供页面卡片复用。 */
  lyricText: string | null;
  /** 当前播放器曲目元数据，用于跨请求/跨列表的卡片匹配兜底。 */
  trackName: string | null;
  trackArtist: string | null;
}

type PlayListener = (payload: GlobalPlayPayload) => void;
type StateListener = (state: GlobalPlaybackState) => void;

// 全站只有一个 GlobalMusicPlayer 常驻在布局持久层（SiteLayoutInner 内），
// 因此全局各保留一个监听器；页面音乐触发卡片经 requestGlobalPlay 通知它，
// 播放状态经 emitGlobalPlaybackState 回传，卡片据此切换播放态图标。
let playListener: PlayListener | null = null;
let stateListener: StateListener | null = null;
let state: GlobalPlaybackState = {
  playing: false,
  cardId: null,
  trackKey: null,
  currentTime: 0,
  lrc: null,
  lyricText: null,
  trackName: null,
  trackArtist: null,
};

/** 全局播放器挂载时注册"追加并播放"监听；返回取消函数。 */
export function setGlobalPlayListener(fn: PlayListener): () => void {
  playListener = fn;
  return () => {
    if (playListener === fn) playListener = null;
  };
}

/** 页面音乐触发卡片点击时调用：把曲目追加到全局播放器末尾并播放。 */
export function requestGlobalPlay(payload: GlobalPlayPayload): void {
  playListener?.(payload);
}

/** 卡片初始化/订阅用：注册播放状态监听；返回取消函数。 */
export function setGlobalStateListener(fn: StateListener): () => void {
  stateListener = fn;
  return () => {
    if (stateListener === fn) stateListener = null;
  };
}

/** 读取当前播放状态（新卡片初始化时用它同步初始态）。 */
export function getGlobalPlaybackState(): GlobalPlaybackState {
  return state;
}

/** 全局播放器更新播放状态（play/pause/ended/listswitch）。 */
export function emitGlobalPlaybackState(next: GlobalPlaybackState): void {
  state = next;
  stateListener?.(state);
}
