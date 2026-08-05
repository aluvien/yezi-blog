import type { MusicTrack } from "@/lib/music";

export interface GlobalPlayPayload {
  /** 本次要追加到全局列表的曲目 */
  tracks: MusicTrack[];
}

type GlobalPlayListener = (payload: GlobalPlayPayload) => void;

// 全站只有一个 GlobalMusicPlayer 常驻在布局持久层（SiteLayoutInner 内），
// 因此全局只保留一个监听器；页面音乐触发卡片通过 requestGlobalPlay 通知它。
let listener: GlobalPlayListener | null = null;

/** 全局播放器挂载时注册监听；返回取消函数（组件卸载时调用）。 */
export function setGlobalPlayListener(fn: GlobalPlayListener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = null;
  };
}

/** 页面音乐触发卡片点击时调用：把曲目追加到全局播放器末尾并播放。 */
export function requestGlobalPlay(payload: GlobalPlayPayload): void {
  listener?.(payload);
}
