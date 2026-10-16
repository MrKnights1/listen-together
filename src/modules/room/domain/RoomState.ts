/**
 * The room, as plain data. Plain on purpose: the same value travels to every
 * browser as JSON and is folded forward there by the same `evolve`, so it must
 * hold no classes, Maps or Dates. Times are epoch milliseconds.
 */
export type RepeatMode = "off" | "one" | "all";

export interface QueueEntry {
  id: string;
  ownerId: string;
  /** `<provider>:<provider track id>`, as the catalog knows it. */
  trackId: string;
  /** Copied from the track when queued: the clock is scheduled by it. */
  durationMs: number;
  addedAt: number;
}

/** The one song everybody is on, and where in it they are. */
export interface NowPlaying {
  entryId: string;
  status: "playing" | "paused";
  /** The position at `anchorAt`. While playing it advances with the wall clock. */
  positionMs: number;
  anchorAt: number;
}

export interface RoomState {
  /** Goes up by one per applied command, so a browser can tell it missed one. */
  version: number;
  /** Every entry in the room: the current one and all queued ones. */
  entries: Record<string, QueueEntry>;
  /**
   * The queued entries in the order they were added, unless moved: the order
   * they play while shuffle is off. Never holds the current entry.
   */
  queue: string[];
  current: NowPlaying | null;
  repeat: RepeatMode;
  /** While on, each next song is drawn at random from the queue instead of taken from its top. */
  shuffle: boolean;
}

export function emptyRoom(): RoomState {
  return { version: 0, entries: {}, queue: [], current: null, repeat: "off", shuffle: false };
}

/** Where a queued entry is in the line, or -1 if it is not queued. */
export function queueIndex(state: RoomState, entryId: string): number {
  return state.queue.indexOf(entryId);
}

/** One person's queued entries, in the order they will play. */
export function queuedBy(state: RoomState, ownerId: string): string[] {
  return state.queue.filter((entryId) => state.entries[entryId]?.ownerId === ownerId);
}

/** The queued entries added at or before `addedUpTo`, in the order they will play. */
export function queuedUpTo(state: RoomState, addedUpTo: number): string[] {
  return state.queue.filter(
    (entryId) => (state.entries[entryId]?.addedAt ?? Infinity) <= addedUpTo,
  );
}
