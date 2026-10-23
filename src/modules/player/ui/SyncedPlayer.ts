import type { ProviderId } from "@/shared/domain/TrackRef.ts";
import type { PlayerAdapter, PlayerEvents } from "./PlayerAdapter.ts";
import {
  freshMemory,
  reconcile,
  type PlayerAction,
  type SyncMemory,
  type SyncStatus,
  type Target,
} from "./reconcile.ts";

/** What the room is asking for, as far as following it goes: a new value is a new instruction. */
const instructionOf = (target: Target | null): string | null =>
  target === null ? null : `${target.providerTrackId}|${target.playing}|${target.setAt}`;

/** Creates a provider's player. One per provider, made the first time a song of theirs plays. */
export type AdapterFactory = (provider: ProviderId, events: PlayerEvents) => Promise<PlayerAdapter>;

export interface SyncedPlayerOptions {
  createAdapter: AdapterFactory;
  /** Where the room says to be at local monotonic time `localNow`, or null when nothing plays. */
  target: (localNow: number) => Target | null;
  /** Local monotonic time. */
  now: () => number;
  /** Told whenever the listener's sync status or error changes. */
  onStatus: (status: SyncStatus, errorCode: number | null) => void;
  /** The browser refused sound without a click: show the "Start listening" button again. */
  onAutoplayBlocked: () => void;
  /** Told whenever the provider's player starts or stops playing (buffering counts as playing). */
  onPlaying: (playing: boolean) => void;
}

/**
 * Keeps one browser's player on the room's timeline. Holds what `reconcile`
 * needs between ticks — the adapter, what is loaded, the last error, the
 * correction memory — and turns its decisions into player calls.
 */
export class SyncedPlayer {
  private adapter: PlayerAdapter | null = null;
  private provider: ProviderId | null = null;
  private creating: Promise<void> | null = null;
  /** The last attempt to make the player failed: nothing tries again until the listener asks. */
  private failed = false;
  private loadedTrackId: string | null = null;
  private error: number | null = null;
  private memory: SyncMemory = freshMemory();
  private listening = false;
  private volume = 100;
  private muted = false;
  private reported: { status: SyncStatus; errorCode: number | null } | null = null;
  private reportedPlaying = false;
  private destroyed = false;
  /** The instruction the last tick acted on. */
  private followed: string | null = null;

  constructor(private readonly options: SyncedPlayerOptions) {}

  /** The listener pressed "Start listening" (or stopped). */
  setListening(listening: boolean): void {
    this.listening = listening;
    if (listening) this.failed = false;
    this.tick();
  }

  setAudio(volume: number, muted: boolean): void {
    this.volume = volume;
    this.muted = muted;
    this.adapter?.setAudio(volume, muted);
  }

  /** Forget the correction history and line up again from scratch. */
  resync(): void {
    this.memory = freshMemory();
    this.error = null;
    this.loadedTrackId = null;
    this.failed = false;
    this.tick();
  }

  /**
   * The room may have changed: a pause, skip or jump is followed now rather
   * than on the next tick. Anything else (drift) is left to the ticks.
   */
  roomChanged(): void {
    if (this.destroyed) return;
    const target = this.options.target(this.options.now());
    if (instructionOf(target) !== this.followed) this.tick();
  }

  /** One step: read the room and the player, decide, act. */
  tick(): void {
    if (this.destroyed) return;
    const now = this.options.now();
    const target = this.options.target(now);
    this.followed = instructionOf(target);

    if (target !== null && this.listening && !this.ready(target.provider)) {
      if (this.failed) {
        this.report("no_player", null);
      } else {
        this.ensureAdapter(target.provider);
        this.report("catching_up", null);
      }
      this.reportPlaying(false);
      return;
    }

    const adapter = this.adapter;
    const view = {
      providerTrackId: this.loadedTrackId,
      state: adapter?.state() ?? "unstarted",
      positionMs: adapter?.positionMs() ?? 0,
      error: this.error,
    };
    const step = reconcile(target, view, this.listening, this.memory, now);
    this.memory = step.memory;
    if (adapter !== null) for (const action of step.actions) this.apply(adapter, action);
    this.report(step.status, step.status === "error" ? this.error : null);
    // As the player last said: a pause asked for now is reported once the player has paused.
    this.reportPlaying(view.state === "playing" || view.state === "buffering");
  }

  destroy(): void {
    this.destroyed = true;
    this.adapter?.destroy();
    this.adapter = null;
  }

  private ready(provider: ProviderId): boolean {
    return this.adapter !== null && this.provider === provider;
  }

  private ensureAdapter(provider: ProviderId): void {
    if (this.creating !== null) return;

    const previous = this.adapter;
    this.adapter = null;
    previous?.destroy();

    this.creating = this.options
      .createAdapter(provider, {
        onStateChange: () => this.tick(),
        onError: (code) => {
          this.error = code;
          this.tick();
        },
        onAutoplayBlocked: () => {
          this.listening = false;
          this.options.onAutoplayBlocked();
          this.tick();
        },
      })
      .then((adapter) => {
        if (this.destroyed) {
          adapter.destroy();
          return;
        }
        this.adapter = adapter;
        this.provider = provider;
        this.loadedTrackId = null;
        adapter.setAudio(this.volume, this.muted);
      })
      .catch((error: unknown) => {
        this.failed = true;
        console.error("Creating the player failed", error);
      })
      .finally(() => {
        this.creating = null;
        this.tick();
      });
  }

  private apply(adapter: PlayerAdapter, action: PlayerAction): void {
    switch (action.type) {
      case "load":
        this.loadedTrackId = action.providerTrackId;
        this.error = null;
        adapter.load(action.providerTrackId, action.startMs, action.play);
        return;
      case "play":
        adapter.play();
        return;
      case "pause":
        adapter.pause();
        return;
      case "seek":
        adapter.seekTo(action.positionMs);
        return;
    }
  }

  private report(status: SyncStatus, errorCode: number | null): void {
    if (this.reported?.status === status && this.reported.errorCode === errorCode) return;
    this.reported = { status, errorCode };
    this.options.onStatus(status, errorCode);
  }

  private reportPlaying(playing: boolean): void {
    if (this.reportedPlaying === playing) return;
    this.reportedPlaying = playing;
    this.options.onPlaying(playing);
  }
}
