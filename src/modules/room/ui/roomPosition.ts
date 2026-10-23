import type { ClockSync } from "@/modules/player/ui/index.ts";
import { positionAt } from "@/modules/room/domain/playback.ts";
import type { RoomState } from "@/modules/room/domain/RoomState.ts";

/** Where the room is in its song at this device's monotonic `localNow`, as the seek bar shows it. */
export function roomPositionMs(state: RoomState, clock: ClockSync, localNow: number): number {
  if (state.current === null) return 0;
  // Until the first pong there is no server time to carry the position forward from its anchor.
  return clock.synced ? positionAt(state, clock.serverNow(localNow)) : state.current.positionMs;
}
