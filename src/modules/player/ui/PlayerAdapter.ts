/** What a provider's player is doing, in one vocabulary for every provider. */
export type PlayerState = "unstarted" | "ended" | "playing" | "paused" | "buffering" | "cued";

/**
 * One provider's embedded player, as the sync loop drives it. Times are in
 * milliseconds here whatever the provider speaks. Adding Spotify means a
 * second implementation of this; nothing that drives it changes.
 */
export interface PlayerAdapter {
  /** Load the track from `startMs` and play it, or cue it there and wait. */
  load(providerTrackId: string, startMs: number, play: boolean): void;
  play(): void;
  pause(): void;
  seekTo(positionMs: number): void;
  /** 0–100. This listener's own volume; never shared. */
  setVolume(volume: number): void;
  setMuted(muted: boolean): void;
  positionMs(): number;
  state(): PlayerState;
  destroy(): void;
}

/** What a player tells the sync loop, as it happens. */
export interface PlayerEvents {
  onStateChange(state: PlayerState): void;
  /** The provider's own error code — YouTube's 2, 5, 100, 101, 150, 153. */
  onError(code: number): void;
  /** The browser refused to start sound without a click. */
  onAutoplayBlocked(): void;
}
