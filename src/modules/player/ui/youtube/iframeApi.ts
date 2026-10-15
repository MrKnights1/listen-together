/**
 * The slice of the YouTube IFrame Player API this app uses, typed locally
 * rather than through a dependency.
 * https://developers.google.com/youtube/iframe_api_reference
 */
export const IFRAME_API_SRC = "https://www.youtube.com/iframe_api";

export interface YTPlayer {
  loadVideoById(options: { videoId: string; startSeconds: number }): void;
  cueVideoById(options: { videoId: string; startSeconds: number }): void;
  playVideo(): void;
  pauseVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
  mute(): void;
  unMute(): void;
  isMuted(): boolean;
  getCurrentTime(): number;
  getPlayerState(): number;
  destroy(): void;
}

export interface YTPlayerOptions {
  width: number;
  height: number;
  playerVars: Record<string, string | number>;
  events: {
    onReady: () => void;
    onStateChange: (event: { data: number }) => void;
    onError: (event: { data: number }) => void;
    onAutoplayBlocked: () => void;
  };
}

export interface YTNamespace {
  Player: new (mount: HTMLElement, options: YTPlayerOptions) => YTPlayer;
}

/** The page's globals the loader touches: where the API lands, and its ready callback. */
export interface IframeApiHost {
  YT?: YTNamespace;
  onYouTubeIframeAPIReady?: () => void;
}

const loading = new WeakMap<IframeApiHost, Promise<YTNamespace>>();

/**
 * Loads YouTube's player API once per page. Its script calls a global
 * `onYouTubeIframeAPIReady` when done; that is the only way it says so.
 */
export function loadYouTubeIframeApi(
  host: IframeApiHost,
  addScript: (src: string) => void,
): Promise<YTNamespace> {
  const existing = loading.get(host);
  if (existing !== undefined) return existing;

  const ready = new Promise<YTNamespace>((resolve) => {
    if (host.YT !== undefined) {
      resolve(host.YT);
      return;
    }
    const before = host.onYouTubeIframeAPIReady;
    host.onYouTubeIframeAPIReady = () => {
      before?.();
      if (host.YT !== undefined) resolve(host.YT);
    };
    addScript(IFRAME_API_SRC);
  });

  loading.set(host, ready);
  return ready;
}
