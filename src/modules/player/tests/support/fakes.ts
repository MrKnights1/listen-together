import type {
  MediaKeyAction,
  MediaSessionPort,
  NowPlayingInfo,
  SilentLoop,
} from "@/modules/player/ui/MediaKeys.ts";
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

  setAudio(volume: number, muted: boolean): void {
    this.volume = volume;
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

/** The browser's media session as the system sees it: what it shows, and a key to press. */
export class FakeMediaSession implements MediaSessionPort {
  metadata: NowPlayingInfo | null = null;
  metadataSets = 0;
  playbackState: "none" | "paused" | "playing" = "none";
  readonly handlers = new Map<MediaKeyAction, () => void>();

  setMetadata(info: NowPlayingInfo | null): void {
    this.metadata = info;
    this.metadataSets += 1;
  }

  setPlaybackState(state: "none" | "paused" | "playing"): void {
    this.playbackState = state;
  }

  setActionHandler(action: MediaKeyAction, handler: (() => void) | null): void {
    if (handler === null) this.handlers.delete(action);
    else this.handlers.set(action, handler);
  }

  /** Presses a media key; one with no handler does nothing, as in the browser. */
  press(action: MediaKeyAction): void {
    this.handlers.get(action)?.();
  }
}

/** A silent loop that records whether it plays, and can be told to refuse. */
export class FakeLoop implements SilentLoop {
  playing = false;
  destroyed = false;
  plays = 0;

  constructor(private readonly refusal: Error | null = null) {}

  play(): Promise<void> {
    this.plays += 1;
    if (this.refusal !== null) return Promise.reject(this.refusal);
    this.playing = true;
    return Promise.resolve();
  }

  pause(): void {
    this.playing = false;
  }

  destroy(): void {
    this.playing = false;
    this.destroyed = true;
  }
}
