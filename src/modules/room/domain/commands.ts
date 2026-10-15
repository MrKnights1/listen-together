import type { RepeatMode } from "./RoomState.ts";

/** A song somebody wants queued, already resolved and given an entry id. */
export interface TrackToQueue {
  entryId: string;
  trackId: string;
  durationMs: number;
}

/**
 * What can be asked of the room. People address the song they can see by its
 * entry id, so a command aimed at a song that has since moved on is refused
 * as stale instead of hitting whatever plays now. `track_ended` and
 * `auto_pause` come from the server's own timers, not from people.
 */
export type RoomCommand =
  | { type: "add"; ownerId: string; tracks: TrackToQueue[] }
  | { type: "pause"; entryId: string }
  | { type: "resume"; entryId: string }
  | { type: "seek"; entryId: string; positionMs: number }
  | { type: "skip"; entryId: string }
  | { type: "remove"; entryId: string }
  | { type: "move"; entryId: string; toIndex: number }
  | { type: "shuffle"; ownerId: string | null }
  | { type: "repeat"; mode: RepeatMode }
  | { type: "track_ended"; entryId: string }
  | { type: "auto_pause" };
