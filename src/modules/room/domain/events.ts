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
  | { type: "advanced"; reason: AdvanceReason; at: number }
  | { type: "paused"; positionMs: number; at: number }
  | { type: "resumed"; at: number }
  | { type: "seeked"; positionMs: number; at: number }
  | { type: "removed"; entryId: string }
  | { type: "moved"; entryId: string; toIndex: number }
  | { type: "shuffled"; lanes: Record<string, string[]> }
  | { type: "repeat_set"; mode: RepeatMode };
