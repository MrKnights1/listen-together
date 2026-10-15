import { describe, expect, test } from "bun:test";
import { decide } from "@/modules/room/domain/decide.ts";
import { MAX_ROOM_ENTRIES } from "@/modules/room/domain/limits.ts";
import { positionAt } from "@/modules/room/domain/playback.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import {
  apply,
  context,
  finishSong,
  firstThree,
  NOW,
  playingOwner,
  ScriptedRandom,
  SONG_MS,
  songs,
} from "@/modules/room/tests/support/room.ts";

function roomWith(...adds: [string, number][]): RoomState {
  let state = emptyRoom();
  for (const [ownerId, count] of adds) {
    state = apply(state, { type: "add", ownerId, tracks: songs(ownerId, count) });
  }
  return state;
}

const currentId = (state: RoomState) => state.current?.entryId ?? "none";

describe("add", () => {
  test("reports what it added", () => {
    const tracks = songs("ada", 2);
    const decision = decide(emptyRoom(), { type: "add", ownerId: "ada", tracks }, context());

    expect(decision.kind === "accepted" ? decision.add : null).toEqual({
      added: tracks.map((one) => one.entryId),
      duplicates: [],
      overflow: 0,
    });
  });

  test("does not add a song already in the person's list", () => {
    const [first] = songs("ada", 1);
    if (first === undefined) throw new Error("no song");
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 1) });
    state = apply(state, { type: "add", ownerId: "ada", tracks: [first] });

    const decision = decide(
      state,
      { type: "add", ownerId: "ada", tracks: [{ ...first, entryId: "again" }] },
      context(),
    );

    expect(decision.kind === "accepted" ? decision.add?.duplicates : null).toEqual([first.trackId]);
    expect(decision.kind === "accepted" ? decision.events : null).toEqual([]);
  });

  test("does not add the song that is playing right now", () => {
    const state = roomWith(["ada", 1]);
    const playing = state.entries[currentId(state)];

    const decision = decide(
      state,
      {
        type: "add",
        ownerId: "bob",
        tracks: [{ entryId: "x", trackId: playing?.trackId ?? "", durationMs: SONG_MS }],
      },
      context(),
    );

    expect(decision.kind === "accepted" ? decision.add?.duplicates : null).toHaveLength(1);
  });

  test("lets two people queue the same song", () => {
    const shared = { entryId: "a1", trackId: "youtube:shared00000", durationMs: SONG_MS };
    let state = roomWith(["cy", 1]);
    state = apply(state, { type: "add", ownerId: "ada", tracks: [shared] });

    const decision = decide(
      state,
      { type: "add", ownerId: "bob", tracks: [{ ...shared, entryId: "b1" }] },
      context(),
    );

    expect(decision.kind === "accepted" ? decision.add?.added : null).toEqual(["b1"]);
  });

  /** Songs play in the order they were added, so nobody's share needs a cap of its own. */
  test("lets one person fill the whole room, counting only what does not fit", () => {
    const state = roomWith(["bob", 1]);

    const decision = decide(
      state,
      { type: "add", ownerId: "ada", tracks: songs("ada", MAX_ROOM_ENTRIES) },
      context(),
    );

    expect(decision.kind === "accepted" ? decision.add?.added.length : null).toBe(
      MAX_ROOM_ENTRIES - 1,
    );
    expect(decision.kind === "accepted" ? decision.add?.overflow : null).toBe(1);
  });

  test("stops at the limit of the whole room", () => {
    let state = emptyRoom();
    for (let person = 0; person < Math.ceil(MAX_ROOM_ENTRIES / 250); person += 1) {
      const room = MAX_ROOM_ENTRIES - Object.keys(state.entries).length;
      state = apply(state, {
        type: "add",
        ownerId: `p${person}`,
        tracks: songs(`p${person}`, Math.min(250, room)),
      });
    }
    expect(Object.keys(state.entries)).toHaveLength(MAX_ROOM_ENTRIES);

    const decision = decide(
      state,
      { type: "add", ownerId: "late", tracks: songs("late", 1) },
      context(),
    );

    expect(decision.kind === "accepted" ? decision.add?.overflow : null).toBe(1);
  });

  test("adding to a playing room does not restart the song", () => {
    const state = roomWith(["ada", 1]);
    const later = apply(
      state,
      { type: "add", ownerId: "bob", tracks: songs("bob", 1) },
      NOW + 5000,
    );

    expect(later.current).toEqual(state.current);
  });
});

describe("pause, resume and seek", () => {
  test("pause freezes the position at the moment of pausing", () => {
    const state = roomWith(["ada", 1]);

    const paused = apply(state, { type: "pause", entryId: currentId(state) }, NOW + 42_000);

    expect(paused.current?.status).toBe("paused");
    expect(positionAt(paused, NOW + 999_999)).toBe(42_000);
  });

  test("resume carries on from where it was paused", () => {
    let state = roomWith(["ada", 1]);
    state = apply(state, { type: "pause", entryId: currentId(state) }, NOW + 42_000);

    state = apply(state, { type: "resume", entryId: currentId(state) }, NOW + 100_000);

    expect(positionAt(state, NOW + 110_000)).toBe(52_000);
  });

  test("pausing a paused room changes nothing and counts as no update", () => {
    let state = roomWith(["ada", 1]);
    state = apply(state, { type: "pause", entryId: currentId(state) }, NOW + 1000);

    const again = decide(state, { type: "pause", entryId: currentId(state) }, context(NOW + 2000));

    expect(again).toEqual({ kind: "accepted", events: [] });
  });

  test("seek jumps everybody to the same place", () => {
    const state = roomWith(["ada", 1]);

    const sought = apply(
      state,
      { type: "seek", entryId: currentId(state), positionMs: 90_000 },
      NOW + 5000,
    );

    expect(positionAt(sought, NOW + 6000)).toBe(91_000);
  });

  test("seek is kept within the song", () => {
    const state = roomWith(["ada", 1]);

    expect(
      positionAt(apply(state, { type: "seek", entryId: currentId(state), positionMs: -5 }), NOW),
    ).toBe(0);
    expect(
      positionAt(apply(state, { type: "seek", entryId: currentId(state), positionMs: 9e9 }), NOW),
    ).toBe(SONG_MS);
  });

  test.each(["pause", "resume", "skip"] as const)(
    "%s aimed at a song that has moved on is stale",
    (type) => {
      const state = roomWith(["ada", 2]);

      expect(decide(state, { type, entryId: "not-playing" }, context())).toEqual({
        kind: "rejected",
        code: "stale",
      });
    },
  );

  test("a seek to a position that is not a number is refused", () => {
    const state = roomWith(["ada", 1]);

    expect(
      decide(state, { type: "seek", entryId: currentId(state), positionMs: Number.NaN }, context()),
    ).toEqual({ kind: "rejected", code: "invalid" });
  });
});

describe("skip and remove", () => {
  test("skip moves everybody to the next song in the queue", () => {
    const state = roomWith(["ada", 2], ["bob", 1]);
    const [next] = state.queue;

    const skipped = apply(state, { type: "skip", entryId: currentId(state) }, NOW + 10_000);

    expect(currentId(skipped)).toBe(next ?? "");
    expect(skipped.current?.positionMs).toBe(0);
    expect(skipped.current?.anchorAt).toBe(NOW + 10_000);
  });

  test("skipping in a paused room cues the next song, still paused", () => {
    let state = roomWith(["ada", 2]);
    state = apply(state, { type: "pause", entryId: currentId(state) });

    state = apply(state, { type: "skip", entryId: currentId(state) });

    expect(state.current?.status).toBe("paused");
    expect(state.current?.positionMs).toBe(0);
  });

  test("removing the song playing acts like skipping it", () => {
    const state = roomWith(["ada", 1], ["bob", 1]);
    const playing = currentId(state);

    const removed = apply(state, { type: "remove", entryId: playing });

    expect(playingOwner(removed)).toBe("bob");
    expect(removed.entries[playing]).toBeUndefined();
  });

  test("removing a queued song takes it out and keeps the rest in order", () => {
    const state = roomWith(["ada", 3], ["bob", 1]);
    const [first, ...rest] = state.queue;

    const removed = apply(state, { type: "remove", entryId: first ?? "" });

    expect(removed.queue).toEqual(rest);
    expect(removed.entries[first ?? ""]).toBeUndefined();
  });

  test("removing the last queued song leaves the queue empty", () => {
    const state = roomWith(["cy", 1], ["ada", 1]);
    const [only] = state.queue;

    const removed = apply(state, { type: "remove", entryId: only ?? "" });

    expect(removed.queue).toEqual([]);
  });

  test("removing a song that is already gone is stale", () => {
    expect(decide(roomWith(["ada", 1]), { type: "remove", entryId: "gone" }, context())).toEqual({
      kind: "rejected",
      code: "stale",
    });
  });
});

describe("move", () => {
  test("moves a song to another place in the queue", () => {
    const state = roomWith(["cy", 1], ["ada", 3]);
    const [a, b, c] = firstThree(state);

    const moved = apply(state, { type: "move", entryId: c, toIndex: 0 });

    expect(moved.queue).toEqual([c, a, b]);
  });

  test("moves a song past somebody else's", () => {
    const state = roomWith(["cy", 1], ["ada", 1], ["bob", 1]);
    const [adas, bobs] = state.queue;

    const moved = apply(state, { type: "move", entryId: bobs ?? "", toIndex: 0 });

    expect<(string | undefined)[]>(moved.queue).toEqual([bobs, adas]);
  });

  test("keeps the target index inside the queue", () => {
    const state = roomWith(["cy", 1], ["ada", 3]);
    const [a, b, c] = firstThree(state);

    expect(apply(state, { type: "move", entryId: a, toIndex: 99 }).queue).toEqual([b, c, a]);
    expect(apply(state, { type: "move", entryId: c, toIndex: -4 }).queue).toEqual([c, a, b]);
  });

  test("moving to where it already is changes nothing", () => {
    const state = roomWith(["cy", 1], ["ada", 3]);
    const [a] = state.queue;

    expect(decide(state, { type: "move", entryId: a ?? "", toIndex: 0 }, context())).toEqual({
      kind: "accepted",
      events: [],
    });
  });

  test("the song playing cannot be moved", () => {
    const state = roomWith(["ada", 2]);

    expect(
      decide(state, { type: "move", entryId: currentId(state), toIndex: 1 }, context()),
    ).toEqual({
      kind: "rejected",
      code: "invalid",
    });
  });
});

describe("shuffle", () => {
  test("shuffles one person's songs among the places they hold, and nobody else's", () => {
    const state = roomWith(["cy", 1], ["ada", 1], ["bob", 1], ["ada", 1], ["bob", 1], ["ada", 1]);
    const [a1, b1, a2, b2, a3] = state.queue;

    // Fisher–Yates picks: index 2 swaps with 0, then index 1 stays.
    const shuffled = apply(
      state,
      { type: "shuffle", ownerId: "ada" },
      NOW,
      new ScriptedRandom([0, 1]),
    );

    expect<(string | undefined)[]>(shuffled.queue).toEqual([a3, b1, a2, b2, a1]);
  });

  test("a list of one has nothing to shuffle", () => {
    expect(
      decide(roomWith(["cy", 1], ["ada", 1]), { type: "shuffle", ownerId: "ada" }, context()),
    ).toEqual({
      kind: "accepted",
      events: [],
    });
  });
});

describe("repeat", () => {
  test("repeat one replays the song when it ends, and the queue waits", () => {
    let state = roomWith(["ada", 1], ["bob", 1]);
    const playing = currentId(state);
    state = apply(state, { type: "repeat", mode: "one" });

    const { state: after } = finishSong(state, NOW);

    expect(currentId(after)).toBe(playing);
    expect(after.current?.positionMs).toBe(0);
    expect(after.queue).toEqual(state.queue);
  });

  test("skipping under repeat one still moves on", () => {
    let state = roomWith(["ada", 1], ["bob", 1]);
    state = apply(state, { type: "repeat", mode: "one" });

    expect(playingOwner(apply(state, { type: "skip", entryId: currentId(state) }))).toBe("bob");
  });

  test("repeat all puts a finished song back at the end of the queue", () => {
    let state = roomWith(["ada", 2], ["bob", 1]);
    const first = currentId(state);
    const [, bobs] = state.queue;
    state = apply(state, { type: "repeat", mode: "all" });

    const { state: after } = finishSong(state, NOW);

    expect<(string | undefined)[]>(after.queue).toEqual([bobs, first]);
    expect(after.entries[first]).toBeDefined();
  });

  test("repeat all with a single song keeps playing it", () => {
    let state = roomWith(["ada", 1]);
    const only = currentId(state);
    state = apply(state, { type: "repeat", mode: "all" });

    const { state: after } = finishSong(state, NOW);

    expect(currentId(after)).toBe(only);
  });

  test("a removed song is not brought back by repeat all", () => {
    let state = roomWith(["ada", 2]);
    const first = currentId(state);
    state = apply(state, { type: "repeat", mode: "all" });

    state = apply(state, { type: "remove", entryId: first });

    expect(state.entries[first]).toBeUndefined();
  });

  test("setting the mode it already has is no update", () => {
    expect(decide(emptyRoom(), { type: "repeat", mode: "off" }, context())).toEqual({
      kind: "accepted",
      events: [],
    });
  });
});

describe("the clock's own commands", () => {
  test("a song ends only when the clock says it has", () => {
    const state = roomWith(["ada", 2]);

    expect(
      decide(state, { type: "track_ended", entryId: currentId(state) }, context(NOW + SONG_MS - 1)),
    ).toEqual({ kind: "rejected", code: "stale" });
  });

  test("a leftover alarm for a paused song does nothing", () => {
    let state = roomWith(["ada", 2]);
    state = apply(state, { type: "pause", entryId: currentId(state) });

    expect(
      decide(state, { type: "track_ended", entryId: currentId(state) }, context(NOW + SONG_MS * 2)),
    ).toEqual({ kind: "rejected", code: "stale" });
  });

  test("auto-pause pauses a playing room and leaves a paused one alone", () => {
    const state = roomWith(["ada", 1]);
    const paused = apply(state, { type: "auto_pause" }, NOW + 30_000);

    expect(paused.current?.status).toBe("paused");
    expect(positionAt(paused, NOW + 90_000)).toBe(30_000);
    expect(decide(paused, { type: "auto_pause" }, context())).toEqual({
      kind: "accepted",
      events: [],
    });
  });
});

describe("version", () => {
  test("goes up once per command that changed something, whatever the number of events", () => {
    const state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 2) });

    // queued + advanced(started): two events, one command.
    expect(state.version).toBe(1);
  });

  test("stays put for a command that changed nothing", () => {
    const state = roomWith(["ada", 1]);

    expect(apply(state, { type: "repeat", mode: "off" }).version).toBe(state.version);
  });
});
