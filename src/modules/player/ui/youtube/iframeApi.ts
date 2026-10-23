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

/** Runs `run` after `ms`; returns the function that cancels it. */
export type After = (ms: number, run: () => void) => () => void;

/** Longer than any page load that is merely slow: past this, the script is not coming. */
export const IFRAME_API_TIMEOUT_MS = 20_000;

const loading = new WeakMap<IframeApiHost, Promise<YTNamespace>>();

/**
 * Loads YouTube's player API once per page. Its script calls a global
 * `onYouTubeIframeAPIReady` when done; that is the only way it says so.
 * Rejects when the script fails to load or never says it is ready, and is
 * then forgotten, so a later call tries again from scratch.
 */
export function loadYouTubeIframeApi(
  host: IframeApiHost,
  addScript: (src: string, onError: () => void) => void,
  after: After,
): Promise<YTNamespace> {
  const existing = loading.get(host);
  if (existing !== undefined) return existing;

  const ready = new Promise<YTNamespace>((resolve, reject) => {
    if (typeof host.YT?.Player === "function") {
      resolve(host.YT);
      return;
    }
    // A `YT` without `Player` is a load that failed halfway: YouTube's script
    // sees it and does nothing, so it has to go before the script runs again.
    delete host.YT;

    const before = host.onYouTubeIframeAPIReady;
    let settled = false;
    const fail = (reason: string) => {
      if (settled) return;
      settled = true;
      cancel();
      if (before === undefined) delete host.onYouTubeIframeAPIReady;
      else host.onYouTubeIframeAPIReady = before;
      reject(new Error(reason));
    };
    host.onYouTubeIframeAPIReady = () => {
      before?.();
      if (settled || typeof host.YT?.Player !== "function") return;
      settled = true;
      cancel();
      resolve(host.YT);
    };
    const cancel = after(IFRAME_API_TIMEOUT_MS, () =>
      fail("YouTube's player script did not say it was ready in time."),
    );
    addScript(IFRAME_API_SRC, () => fail("YouTube's player script did not load."));
  });

  loading.set(host, ready);
  ready.catch(() => {
    if (loading.get(host) === ready) loading.delete(host);
  });
  return ready;
}
