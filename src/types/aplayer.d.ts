declare module "aplayer" {
  export interface APlayerAudio {
    name: string;
    artist?: string;
    url: string;
    cover?: string;
    lrc?: string;
  }
  export interface APlayerOptions {
    container: HTMLElement;
    audio: APlayerAudio[];
    listFolded?: boolean;
    autoplay?: boolean;
    order?: "list" | "random";
    loop?: "all" | "one" | "none";
    volume?: number;
    theme?: string;
    fixed?: boolean;
    mini?: boolean;
  }
  export default class APlayer {
    constructor(options: APlayerOptions);
    destroy(): void;
    play(): void;
    pause(): void;
  }
}
