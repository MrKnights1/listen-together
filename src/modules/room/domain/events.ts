import type { QueueEntry, RepeatMode } from "./RoomState.ts";

/**
 * Why the room moved on. `started` is the idle room picking up a song;
 * `ended` is the clock running out; `skipped` and `removed` are people.
 */
export type AdvanceReason = "started" | "ended" | "skipped" | "removed";

/**
 * Facts about what happened to the room. The server and every browser fold
 * the same events through the same `evolve`, so these are the whole protocol
 * of change — small enough to broadcast, complete enough to replay.
 */
export type RoomEvent =
  | { type: "queued"; entries: QueueEntry[] }
  /**
   * `next` is the entry that plays now, chosen when the command was decided —
   * at random while shuffle is on — so every fold lands on the same song.
   * Null when nothing is left to play.
   */
  | { type: "advanced"; reason: AdvanceReason; next: string | null; at: number }
  | { type: "paused"; positionMs: number; at: number }
  | { type: "resumed"; at: number }
  | { type: "seeked"; positionMs: number; at: number }
  | { type: "removed"; entryId: string }
  | { type: "moved"; entryId: string; toIndex: number }
  /** Queued entries taken out all at once. Never the one playing. */
  | { type: "cleared"; entryIds: string[] }
  /** The whole queue in its new order. */
  | { type: "shuffled"; queue: string[] }
  | { type: "repeat_set"; mode: RepeatMode }
  | { type: "shuffle_set"; on: boolean };
