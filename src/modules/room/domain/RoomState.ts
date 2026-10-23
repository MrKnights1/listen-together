import { MAX_ROOM_ENTRIES } from "./limits.ts";

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

/** A song the room moved on from: shown, and offered to be added again. */
export interface PlayedSong {
  trackId: string;
  /** Who had queued it. */
  ownerId: string;
  /** When the room moved on from it. */
  at: number;
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
  /**
   * Queued entries somebody starred to play next, in the order they were
   * starred. While shuffle is on they play before any random draw; while it
   * is off they wait, unused, for it to come back on. Never holds the current entry.
   */
  starred: string[];
  /** The songs the room moved on from, newest first, each once. */
  played: PlayedSong[];
}

export function emptyRoom(): RoomState {
  return {
    version: 0,
    entries: {},
    queue: [],
    current: null,
    repeat: "off",
    shuffle: false,
    starred: [],
    played: [],
  };
}

/** Every song the room shows: those in it, and those it played. Their details must stay known. */
export function trackIdsInUse(state: RoomState): string[] {
  return [
    ...new Set([
      ...Object.values(state.entries).map((entry) => entry.trackId),
      ...state.played.map((song) => song.trackId),
    ]),
  ];
}

/** Everybody whose name the room shows beside a song, queued or played. */
export function ownerIdsInView(state: RoomState): string[] {
  return [
    ...new Set([
      ...Object.values(state.entries).map((entry) => entry.ownerId),
      ...state.played.map((song) => song.ownerId),
    ]),
  ];
}

/** Where a queued entry is in the line, or -1 if it is not queued. */
export function queueIndex(state: RoomState, entryId: string): number {
  return state.queue.indexOf(entryId);
}

/** One person's queued entries, in the order they will play. */
export function queuedBy(state: RoomState, ownerId: string): string[] {
  return state.queue.filter((entryId) => state.entries[entryId]?.ownerId === ownerId);
}

/**
 * The most songs one paste by `ownerId` can put to use: every free place, and
 * as many again as could come back as duplicates of their own list or of the
 * song playing, which take no place.
 */
export function pasteAllowance(state: RoomState, ownerId: string): number {
  const free = Math.max(0, MAX_ROOM_ENTRIES - Object.keys(state.entries).length);
  return free + queuedBy(state, ownerId).length + (state.current === null ? 0 : 1);
}

/** The queued entries added at or before `addedUpTo`, in the order they will play. */
export function queuedUpTo(state: RoomState, addedUpTo: number): string[] {
  return state.queue.filter(
    (entryId) => (state.entries[entryId]?.addedAt ?? Infinity) <= addedUpTo,
  );
}
