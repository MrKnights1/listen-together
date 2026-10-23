import type { PlayerAdapter, PlayerEvents, PlayerState } from "../PlayerAdapter.ts";
import type { After, YTNamespace, YTPlayer } from "./iframeApi.ts";

/**
 * The tile is 200×200: YouTube's minimum embedded viewport. Audio is what the
 * room is for, but the player must stay visible at at least this size.
 */
export const PLAYER_SIZE_PX = 200;

/** A player that has not said it is ready by then never will. */
export const PLAYER_READY_TIMEOUT_MS = 20_000;

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
   * own, inline on phones. Rejects, and takes the player down, if it never
   * gets ready.
   */
  static create(
    api: YTNamespace,
    mount: HTMLElement,
    origin: string,
    events: PlayerEvents,
    after: After,
  ): Promise<YouTubeIframeAdapter> {
    return new Promise((resolve, reject) => {
      const cancel = after(PLAYER_READY_TIMEOUT_MS, () => {
        player.destroy();
        reject(new Error("YouTube's player did not get ready in time."));
      });
      const player = new api.Player(mount, {
        width: PLAYER_SIZE_PX,
        height: PLAYER_SIZE_PX,
        playerVars: { controls: 0, disablekb: 1, playsinline: 1, rel: 0, enablejsapi: 1, origin },
        events: {
          onReady: () => {
            cancel();
            resolve(new YouTubeIframeAdapter(player));
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

  /**
   * YouTube's `unMute()` lifts a volume of 0 back to 5, so silence is its own
   * mute, unmuting happens only when the player is muted, and the volume is set
   * after it — whatever `unMute()` restored is overwritten.
   */
  setAudio(volume: number, muted: boolean): void {
    if (muted || volume <= 0) {
      if (!this.player.isMuted()) this.player.mute();
      return;
    }
    if (this.player.isMuted()) this.player.unMute();
    this.player.setVolume(Math.round(Math.min(volume, 100)));
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
