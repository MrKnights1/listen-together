import type { Clock } from "@/shared/domain/Clock.ts";
import type { Timers } from "@/shared/domain/Timers.ts";
import { describeActivity, type ActivityEntry } from "@/modules/room/domain/activity.ts";
import type { RoomCommand } from "@/modules/room/domain/commands.ts";
import { decide, type Decision } from "@/modules/room/domain/decide.ts";
import { RoomSuspended } from "@/modules/room/domain/errors.ts";
import type { RoomEvent } from "@/modules/room/domain/events.ts";
import { commit } from "@/modules/room/domain/evolve.ts";
import { TRACK_END_GRACE_MS } from "@/modules/room/domain/limits.ts";
import { endsAt } from "@/modules/room/domain/playback.ts";
import type { ActivityRepository } from "@/modules/room/domain/ports/ActivityRepository.ts";
import type { Random } from "@/modules/room/domain/ports/Random.ts";
import type { RoomRepository } from "@/modules/room/domain/ports/RoomRepository.ts";
import { emptyRoom, trackIdsInUse, type RoomState } from "@/modules/room/domain/RoomState.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";
import { SerialQueue } from "./SerialQueue.ts";

/** One applied command, as everybody listening needs to hear about it. */
export interface RoomUpdate {
  version: number;
  actorId: string | null;
  events: RoomEvent[];
  /** Songs this command brought into the room, so listeners can show them. */
  tracks: TrackInfo[];
  activity: ActivityEntry | null;
}

export type RoomListener = (update: RoomUpdate) => void;

export interface RoomEngineDependencies {
  rooms: RoomRepository;
  activity: ActivityRepository;
  clock: Clock;
  timers: Timers;
  random: Random;
}

/**
 * The one room, live. Commands are applied one at a time; each is decided,
 * saved, and only then made visible and announced — a change nobody could
 * recover after a crash is never shown to anyone. The engine also owns the
 * room's single timer: the end of the current song.
 */
export class RoomEngine {
  private state: RoomState = emptyRoom();
  private readonly tracks = new Map<string, TrackInfo>();
  private readonly listeners = new Set<RoomListener>();
  private readonly queue = new SerialQueue();
  private cancelAlarm: (() => void) | null = null;
  private suspended = false;

  constructor(private readonly deps: RoomEngineDependencies) {}

  /** Installs a restored room, before anyone can reach it. */
  load(state: RoomState, tracks: TrackInfo[]): void {
    this.state = state;
    this.tracks.clear();
    for (const track of tracks) this.tracks.set(track.trackId, track);
    this.rearm();
  }

  /** The room as it stands, with what is known about every song in it. */
  snapshot(): { state: RoomState; tracks: TrackInfo[] } {
    return { state: this.state, tracks: [...this.tracks.values()] };
  }

  subscribe(listener: RoomListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Applies a command. `actorId` is who asked, or null for the room's own
   * timers; `newTracks` describes songs an `add` brings in.
   */
  execute(command: RoomCommand, actorId: string | null, newTracks: TrackInfo[]): Promise<Decision> {
    return this.queue.run(() => this.apply(command, actorId, newTracks));
  }

  /**
   * Stops for shutdown: no more commands, no more alarms, and the room saved
   * as cleanly shut down so a quick restart can carry on where it left off.
   * Queued behind any command already running, so that command finishes first.
   */
  suspend(): Promise<void> {
    return this.queue.run(async () => {
      this.suspended = true;
      this.cancelAlarm?.();
      this.cancelAlarm = null;
      await this.deps.rooms.save(this.state, this.deps.clock.now().getTime(), true);
    });
  }

  private async apply(
    command: RoomCommand,
    actorId: string | null,
    newTracks: TrackInfo[],
  ): Promise<Decision> {
    if (this.suspended) throw new RoomSuspended();

    const now = this.deps.clock.now().getTime();
    const before = this.state;
    const decision = decide(before, command, { now, random: this.deps.random });
    if (decision.kind === "rejected" || decision.events.length === 0) return decision;

    const after = commit(before, decision.events);
    const incoming = new Map(newTracks.map((track) => [track.trackId, track]));
    const titleOf = (trackId: string) => (this.tracks.get(trackId) ?? incoming.get(trackId))?.title;

    // Saved first. If this throws, nothing has changed and nobody was told.
    await this.deps.rooms.save(after, now, false);

    let activity: ActivityEntry | null = null;
    const line = describeActivity(before, command, decision.add, actorId, titleOf, now);
    if (line !== null) {
      try {
        activity = await this.deps.activity.record(line);
      } catch (error) {
        // The feed is a courtesy; failing to write it must not undo a saved change.
        console.error("Recording room activity failed", error);
      }
    }

    this.state = after;
    const added = this.keepTracks(after, incoming);
    this.rearm();
    this.announce({
      version: after.version,
      actorId,
      events: decision.events,
      tracks: added,
      activity,
    });
    return decision;
  }

  /** Remembers the songs now in the room and forgets the ones that left. Returns the new ones. */
  private keepTracks(state: RoomState, incoming: Map<string, TrackInfo>): TrackInfo[] {
    const inRoom = new Set(trackIdsInUse(state));
    const added: TrackInfo[] = [];

    for (const trackId of inRoom) {
      const fresh = incoming.get(trackId);
      if (fresh !== undefined && !this.tracks.has(trackId)) {
        this.tracks.set(trackId, fresh);
        added.push(fresh);
      }
    }
    for (const trackId of this.tracks.keys()) {
      if (!inRoom.has(trackId)) this.tracks.delete(trackId);
    }
    return added;
  }

  /** Points the room's one timer at the end of whatever is playing now. */
  private rearm(): void {
    this.cancelAlarm?.();
    this.cancelAlarm = null;

    const end = endsAt(this.state);
    const entryId = this.state.current?.entryId;
    if (end === null || entryId === undefined || this.suspended) return;

    const delay = end + TRACK_END_GRACE_MS - this.deps.clock.now().getTime();
    this.cancelAlarm = this.deps.timers.after(delay, async () => {
      await this.execute({ type: "track_ended", entryId }, null, []);
    });
  }

  private announce(update: RoomUpdate): void {
    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch (error) {
        console.error("A room listener failed", error);
      }
    }
  }
}
