import type { PlayerAdapter, PlayerEvents, PlayerState } from "../PlayerAdapter.ts";
import type { YTNamespace, YTPlayer } from "./iframeApi.ts";

/**
 * The tile is 200×200: YouTube's minimum embedded viewport. Audio is what the
 * room is for, but the player must stay visible at at least this size.
 */
export const PLAYER_SIZE_PX = 200;

const STATES: Record<number, PlayerState> = {
  [-1]: "unstarted",
  0: "ended",
  1: "playing",
  2: "paused",
  3: "buffering",
  5: "cued",
};

/** YouTube's embedded player behind the provider-neutral port. */
export class YouTubeIframeAdapter implements PlayerAdapter {
  private constructor(private readonly player: YTPlayer) {}

  /**
   * Creates the player in `mount` and resolves once it takes commands. Our
   * own buttons drive it: no YouTube controls, no keyboard shortcuts of its
   * own, inline on phones.
   */
  static create(
    api: YTNamespace,
    mount: HTMLElement,
    origin: string,
    events: PlayerEvents,
  ): Promise<YouTubeIframeAdapter> {
    return new Promise((resolve) => {
      let adapter: YouTubeIframeAdapter | null = null;
      const player = new api.Player(mount, {
        width: PLAYER_SIZE_PX,
        height: PLAYER_SIZE_PX,
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, enablejsapi: 1, origin },
        events: {
          onReady: () => {
            adapter = new YouTubeIframeAdapter(player);
            resolve(adapter);
          },
          onStateChange: (event) => events.onStateChange(STATES[event.data] ?? "unstarted"),
          onError: (event) => events.onError(event.data),
          onAutoplayBlocked: () => events.onAutoplayBlocked(),
        },
      });
    });
  }

  load(providerTrackId: string, startMs: number, play: boolean): void {
    const options = { videoId: providerTrackId, startSeconds: Math.max(0, startMs) / 1000 };
    if (play) this.player.loadVideoById(options);
    else this.player.cueVideoById(options);
  }

  play(): void {
    this.player.playVideo();
  }

  pause(): void {
    this.player.pauseVideo();
  }

  seekTo(positionMs: number): void {
    // Seeking ahead of what is buffered must fetch it: this is a jump, not a drag.
    this.player.seekTo(Math.max(0, positionMs) / 1000, true);
  }

  setVolume(volume: number): void {
    this.player.setVolume(Math.round(Math.min(Math.max(volume, 0), 100)));
  }

  setMuted(muted: boolean): void {
    if (muted) this.player.mute();
    else this.player.unMute();
  }

  positionMs(): number {
    return Math.round(this.player.getCurrentTime() * 1000);
  }

  state(): PlayerState {
    return STATES[this.player.getPlayerState()] ?? "unstarted";
  }

  destroy(): void {
    this.player.destroy();
  }
}
