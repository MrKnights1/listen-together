import type { Clock } from "@/shared/domain/Clock.ts";
import type { IdGenerator } from "@/shared/domain/IdGenerator.ts";
import type { Timers } from "@/shared/domain/Timers.ts";
import type { ActivityEntry, NewActivity } from "@/modules/room/domain/activity.ts";
import { LinkRejected, type LinkRejectionCode } from "@/modules/room/domain/errors.ts";
import type { ActivityRepository } from "@/modules/room/domain/ports/ActivityRepository.ts";
import type { Paste, PasteLog } from "@/modules/room/domain/ports/PasteLog.ts";
import type { RoomRepository, StoredRoom } from "@/modules/room/domain/ports/RoomRepository.ts";
import type {
  LinkScope,
  ResolvedLink,
  TrackSource,
} from "@/modules/room/domain/ports/TrackSource.ts";
import type { RoomState } from "@/modules/room/domain/RoomState.ts";
import type { TrackInfo } from "@/modules/room/domain/TrackInfo.ts";

export class FakeClock implements Clock {
  constructor(private current: number) {}

  now(): Date {
    return new Date(this.current);
  }

  set(ms: number): void {
    this.current = ms;
  }

  get ms(): number {
    return this.current;
  }
}

/**
 * Timers on the fake clock. Nothing fires until the test moves time with
 * `advanceTo`, which fires every task that has come due, in time order — and
 * awaits each, so whatever a task starts has finished when it returns.
 */
export class ManualTimers implements Timers {
  private tasks: { at: number; run: () => void | Promise<void>; id: number }[] = [];
  private nextId = 0;

  constructor(private readonly clock: FakeClock) {}

  every(milliseconds: number, tick: () => void | Promise<void>): () => void {
    let cancel: () => void = () => undefined;
    const schedule = (): void => {
      cancel = this.after(milliseconds, async () => {
        schedule();
        await tick();
      });
    };
    schedule();
    return () => cancel();
  }

  after(milliseconds: number, fire: () => void | Promise<void>): () => void {
    const id = (this.nextId += 1);
    this.tasks.push({ at: this.clock.ms + Math.max(0, milliseconds), run: fire, id });
    return () => {
      this.tasks = this.tasks.filter((task) => task.id !== id);
    };
  }

  /** When the earliest pending task is due, or null. */
  get nextAt(): number | null {
    return this.tasks.reduce<number | null>(
      (min, task) => (min === null || task.at < min ? task.at : min),
      null,
    );
  }

  get pending(): number {
    return this.tasks.length;
  }

  async advanceTo(ms: number): Promise<void> {
    for (;;) {
      const due = this.tasks
        .filter((task) => task.at <= ms)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.tasks = this.tasks.filter((task) => task.id !== due.id);
      this.clock.set(Math.max(this.clock.ms, due.at));
      await due.run();
    }
    this.clock.set(Math.max(this.clock.ms, ms));
  }
}

export class InMemoryRoomRepository implements RoomRepository {
  stored: StoredRoom | null = null;
  saves = 0;
  failNextSave = false;

  async load(): Promise<StoredRoom | null> {
    // A copy, as a database would hand back: nothing shared with the caller.
    return this.stored === null ? null : structuredClone(this.stored);
  }

  async save(state: RoomState, savedAt: number, cleanShutdown: boolean): Promise<void> {
    if (this.failNextSave) {
      this.failNextSave = false;
      throw new Error("disk full");
    }
    this.saves += 1;
    this.stored = structuredClone({ state, savedAt, cleanShutdown });
  }
}

export class InMemoryActivityRepository implements ActivityRepository {
  private entries: ActivityEntry[] = [];
  private nextId = 0;

  async record(activity: NewActivity): Promise<ActivityEntry> {
    const entry = { ...structuredClone(activity), id: (this.nextId += 1) };
    this.entries.push(entry);
    return entry;
  }

  async recent(limit: number): Promise<ActivityEntry[]> {
    return this.entries.slice(-limit);
  }

  async purgeBefore(cutoff: number): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter((entry) => entry.at >= cutoff);
    return before - this.entries.length;
  }

  all(): ActivityEntry[] {
    return [...this.entries];
  }
}

export function trackInfo(name: string, durationMs = 200_000): TrackInfo {
  return {
    trackId: `youtube:${name}`,
    provider: "youtube",
    providerTrackId: name,
    title: `Song ${name}`,
    artist: "Artist",
    durationMs,
    artworkUrl: null,
  };
}

/** The catalog as a table of links, recording what the room asked of it. */
export class StubTrackSource implements TrackSource {
  readonly links = new Map<string, ResolvedLink>();
  readonly known = new Map<string, TrackInfo>();
  rejectWith: LinkRejectionCode | null = null;
  /** The scope each resolve was asked for, in order. */
  readonly scopes: LinkScope[] = [];
  /** The most songs each resolve was allowed, in order. */
  readonly limits: number[] = [];
  unplayable: string[] = [];
  maintainedWith: string[][] = [];

  link(pasted: string, tracks: TrackInfo[], extra: Partial<ResolvedLink> = {}): void {
    this.links.set(pasted, { tracks, skipped: [], truncated: false, ...extra });
    for (const track of tracks) this.known.set(track.trackId, track);
  }

  async resolve(pasted: string, scope: LinkScope, limit: number): Promise<ResolvedLink> {
    this.scopes.push(scope);
    this.limits.push(limit);
    if (this.rejectWith !== null) throw new LinkRejected(this.rejectWith);
    const resolved = this.links.get(pasted);
    if (resolved === undefined) throw new LinkRejected("unsupported_url");
    return resolved;
  }

  async describe(trackIds: string[]): Promise<TrackInfo[]> {
    return trackIds
      .map((id) => this.known.get(id))
      .filter((one): one is TrackInfo => one !== undefined);
  }

  async maintain(referencedTrackIds: string[]): Promise<string[]> {
    this.maintainedWith.push([...referencedTrackIds].sort());
    return this.unplayable.filter((id) => referencedTrackIds.includes(id));
  }
}

/** Pastes kept in memory, in the order they were recorded. */
export class RecordingPasteLog implements PasteLog {
  readonly pastes: Paste[] = [];

  record(paste: Paste): void {
    this.pastes.push(paste);
  }
}

export class SequenceIds implements IdGenerator {
  private issued = 0;

  newId(): string {
    this.issued += 1;
    return `entry-${this.issued}`;
  }
}

/** People by id, recording what the room asked about. */
export class InMemoryPeopleDirectory {
  readonly asked: string[][] = [];

  constructor(private readonly people: Record<string, string> = {}) {}

  async find(ids: string[]) {
    this.asked.push([...ids]);
    return ids.flatMap((id) => {
      const name = this.people[id];
      return name === undefined
        ? []
        : [{ id, name, avatarUrl: `https://cdn.discordapp.com/embed/avatars/0.png` }];
    });
  }
}
