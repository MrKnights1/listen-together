import type { RoomState } from "./RoomState.ts";

/**
 * Where the room is in the current song at `now`. While playing, the position
 * advances with the wall clock from its anchor, and stops at the end of the
 * song rather than running past it.
 */
export function positionAt(state: RoomState, now: number): number {
  const current = state.current;
  if (current === null) return 0;
  if (current.status === "paused") return current.positionMs;

  const durationMs = state.entries[current.entryId]?.durationMs ?? 0;
  return Math.min(current.positionMs + Math.max(0, now - current.anchorAt), durationMs);
}

/** When the current song ends if nobody touches anything, or null when nothing is playing. */
export function endsAt(state: RoomState): number | null {
  const current = state.current;
  if (current === null || current.status === "paused") return null;

  const durationMs = state.entries[current.entryId]?.durationMs ?? 0;
  return current.anchorAt + (durationMs - current.positionMs);
}
