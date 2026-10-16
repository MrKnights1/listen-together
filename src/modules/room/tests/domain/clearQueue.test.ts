import { describe, expect, test } from "bun:test";
import { decide } from "@/modules/room/domain/decide.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import { apply, context, finishSong, NOW, songs } from "@/modules/room/tests/support/room.ts";

const ids = (tracks: { entryId: string }[]) => tracks.map((track) => track.entryId);

/** Ada's three songs, the first one playing, then Bob's two a second later. */
function busyRoom(): RoomState {
  const state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 3) }, NOW);
  return apply(state, { type: "add", ownerId: "bob", tracks: songs("bob", 2) }, NOW + 1000);
}

describe("clearing the queue", () => {
  test("takes out every queued song, whoever added it", () => {
    const before = busyRoom();

    const decision = decide(before, { type: "clear", addedUpTo: NOW + 1000 }, context(NOW + 5000));
    const after = apply(before, { type: "clear", addedUpTo: NOW + 1000 }, NOW + 5000);

    expect(decision).toEqual({
      kind: "accepted",
      events: [{ type: "cleared", entryIds: before.queue }],
    });
    expect(after.queue).toEqual([]);
    expect(Object.keys(after.entries)).toEqual([before.current?.entryId ?? "none"]);
    expect(after.version).toBe(before.version + 1);
  });

  test("leaves the song playing as it was, at the same moment", () => {
    const before = busyRoom();
    const playing = before.current?.entryId ?? "none";
    const paused = apply(before, { type: "pause", entryId: playing }, NOW + 30_000);

    const after = apply(paused, { type: "clear", addedUpTo: NOW + 1000 }, NOW + 40_000);

    expect(after.current).toEqual(paused.current);
    expect(after.entries[playing]).toEqual(paused.entries[playing]);
  });

  test("keeps a song added after the newest one the person saw", () => {
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 2) }, NOW);
    const late = songs("bob", 1);
    state = apply(state, { type: "add", ownerId: "bob", tracks: late }, NOW + 2000);

    const after = apply(state, { type: "clear", addedUpTo: NOW }, NOW + 3000);

    expect(after.queue).toEqual(ids(late));
  });

  test("changes nothing when there is nothing it may take", () => {
    const playingAlone = apply(emptyRoom(), {
      type: "add",
      ownerId: "ada",
      tracks: songs("ada", 1),
    });
    const newerThanSeen = busyRoom();

    for (const [state, addedUpTo] of [
      [emptyRoom(), NOW],
      [playingAlone, NOW],
      [newerThanSeen, NOW - 1],
    ] as const) {
      expect(decide(state, { type: "clear", addedUpTo }, context())).toEqual({
        kind: "accepted",
        events: [],
      });
      expect(apply(state, { type: "clear", addedUpTo }).version).toBe(state.version);
    }
  });

  test("refuses a bound that is not a time", () => {
    expect(decide(busyRoom(), { type: "clear", addedUpTo: Number.NaN }, context())).toEqual({
      kind: "rejected",
      code: "invalid",
    });
  });

  test("with shuffle on, a skip afterwards has nothing left to draw", () => {
    let state = apply(busyRoom(), { type: "set_shuffle", on: true });
    state = apply(state, { type: "clear", addedUpTo: NOW + 1000 });

    const skipped = apply(state, { type: "skip", entryId: state.current?.entryId ?? "none" });

    expect(skipped.current).toBeNull();
    expect(skipped.entries).toEqual({});
  });

  test("with repeat all, the song playing comes round again on its own", () => {
    let state = apply(busyRoom(), { type: "repeat", mode: "all" });
    state = apply(state, { type: "clear", addedUpTo: NOW + 1000 });
    const playing = state.current?.entryId;

    const next = finishSong(state, NOW).state;

    expect(next.current?.entryId).toBe(playing);
    expect(next.current?.positionMs).toBe(0);
    expect(next.queue).toEqual([]);
  });
});
