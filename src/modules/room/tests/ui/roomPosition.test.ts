import { describe, expect, test } from "bun:test";
import { ClockSync } from "@/modules/player/ui/index.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import { roomPositionMs } from "@/modules/room/ui/roomPosition.ts";

/** A clock whose server time is local time plus 1_000_000. */
function syncedClock(): ClockSync {
  const clock = new ClockSync();
  clock.record(0, 0, 1_000_000);
  return clock;
}

function room(status: "playing" | "paused"): RoomState {
  return {
    ...emptyRoom(),
    entries: {
      e1: { id: "e1", ownerId: "ada", trackId: "youtube:one", durationMs: 200_000, addedAt: 0 },
    },
    current: { entryId: "e1", status, positionMs: 30_000, anchorAt: 1_010_000 },
  };
}

describe("roomPositionMs", () => {
  test("is the start when nothing plays", () => {
    expect(roomPositionMs(emptyRoom(), syncedClock(), 50_000)).toBe(0);
  });

  test("moves on from the anchor with the server's clock while playing", () => {
    // Local 15_000 is server 1_015_000: five seconds past the anchor.
    expect(roomPositionMs(room("playing"), syncedClock(), 15_000)).toBe(35_000);
  });

  test("stays where the room paused", () => {
    expect(roomPositionMs(room("paused"), syncedClock(), 90_000)).toBe(30_000);
  });

  test("shows the anchor until the clock is measured, rather than guess", () => {
    expect(roomPositionMs(room("playing"), new ClockSync(), 15_000)).toBe(30_000);
  });
});
