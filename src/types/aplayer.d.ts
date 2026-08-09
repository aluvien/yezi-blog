declare module "aplayer" {
  export interface APlayerAudio {
    name: string;
    artist?: string;
    url: string;
    cover?: string;
    lrc?: string;
    key?: string;
  }
  export interface APlayerOptions {
    container: HTMLElement;
    audio: APlayerAudio[];
    listFolded?: boolean;
    lrcType?: number | boolean;
    autoplay?: boolean;
    order?: "list" | "random";
    loop?: "all" | "one" | "none";
    volume?: number;
    theme?: string;
    fixed?: boolean;
    mini?: boolean;
  }
  export interface APlayerList {
    add(audios: APlayerAudio[], index?: number): void;
    switch(index: number): void;
    remove(index: number): void;
    clear(): void;
    audios: APlayerAudio[];
    index: number;
  }
  export interface APlayerEventPayload {
    index?: number;
  }
  export type APlayerLrcLine = [number, string];
  export interface APlayerLrc {
    container: HTMLElement;
    parsed: Array<APlayerLrcLine[] | undefined>;
    current: APlayerLrcLine[];
    index: number;
    parse(value: string): APlayerLrcLine[];
    switch(index: number): void;
    update(currentTime?: number): void;
  }
  export default class APlayer {
    constructor(options: APlayerOptions);
    destroy(): void;
    play(): void;
    pause(): void;
    skipForward(): void;
    paused: boolean;
    audio: HTMLAudioElement;
    options: APlayerOptions;
    list: APlayerList;
    lrc?: APlayerLrc;
    on(event: string, handler: (arg?: APlayerEventPayload) => void): void;
  }
}
