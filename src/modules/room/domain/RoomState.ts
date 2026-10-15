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
  /** Each person's queued entries, in their order. Never holds the current entry, never an empty list. */
  lanes: Record<string, string[]>;
  /**
   * The line: a rotation key per person waiting, lowest goes next. Everybody
   * with a non-empty list holds one, except whoever's song is playing — they
   * rejoin at the back when it ends.
   */
  keys: Record<string, number>;
  /** The last rotation key handed out. Only ever increases. */
  counter: number;
  current: NowPlaying | null;
  repeat: RepeatMode;
}

export function emptyRoom(): RoomState {
  return { version: 0, entries: {}, lanes: {}, keys: {}, counter: 0, current: null, repeat: "off" };
}

/** How many entries are waiting, not counting the one playing. */
export function queuedCount(state: RoomState): number {
  return Object.values(state.lanes).reduce((total, lane) => total + lane.length, 0);
}

/** The owner's lane and the entry's index in it, or null if it is not queued. */
export function laneOf(
  state: RoomState,
  entryId: string,
): { ownerId: string; index: number } | null {
  const entry = state.entries[entryId];
  if (entry === undefined) return null;
  const index = state.lanes[entry.ownerId]?.indexOf(entryId) ?? -1;
  return index === -1 ? null : { ownerId: entry.ownerId, index };
}
