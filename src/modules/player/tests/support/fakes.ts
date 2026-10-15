import type {
  PlayerAdapter,
  PlayerEvents,
  PlayerState,
} from "@/modules/player/ui/PlayerAdapter.ts";

/** A player that does what it is told, instantly, and records every call. */
export class FakeAdapter implements PlayerAdapter {
  readonly calls: string[] = [];
  current: { id: string | null; state: PlayerState; positionMs: number } = {
    id: null,
    state: "unstarted",
    positionMs: 0,
  };
  volume = -1;
  muted: boolean | null = null;
  destroyed = false;

  constructor(readonly events: PlayerEvents) {}

  load(providerTrackId: string, startMs: number, play: boolean): void {
    this.calls.push(`load ${providerTrackId} @${startMs} ${play ? "play" : "cue"}`);
    this.current = { id: providerTrackId, state: play ? "playing" : "cued", positionMs: startMs };
  }

  play(): void {
    this.calls.push("play");
    this.current.state = "playing";
  }

  pause(): void {
    this.calls.push("pause");
    this.current.state = "paused";
  }

  seekTo(positionMs: number): void {
    this.calls.push(`seek ${positionMs}`);
    this.current.positionMs = positionMs;
  }

  setVolume(volume: number): void {
    this.volume = volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  positionMs(): number {
    return this.current.positionMs;
  }

  state(): PlayerState {
    return this.current.state;
  }

  destroy(): void {
    this.destroyed = true;
  }
}
