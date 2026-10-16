import { describe, expect, test } from "bun:test";
import { decide } from "@/modules/room/domain/decide.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import {
  apply,
  context,
  firstThree,
  NOW,
  ScriptedRandom,
  SONG_MS,
  songs,
} from "@/modules/room/tests/support/room.ts";

/** A room playing one song with `queued` more waiting, shuffle switched to `shuffle`. */
function playingWith(queued: number, shuffle: boolean): RoomState {
  let state = apply(emptyRoom(), { type: "add", ownerId: "cy", tracks: songs("cy", 1) });
  state = apply(state, { type: "add", ownerId: "ada", tracks: songs("ada", queued) });
  return shuffle ? apply(state, { type: "set_shuffle", on: true }) : state;
}

const currentId = (state: RoomState) => state.current?.entryId ?? "none";
const star = (state: RoomState, entryId: string, on = true) =>
  apply(state, { type: "star", entryId, on });
const skip = (state: RoomState, draw: number) =>
  apply(state, { type: "skip", entryId: currentId(state) }, NOW, new ScriptedRandom([draw]));
const END = NOW + SONG_MS + 1000;

describe("starring a song to play next while shuffle is on", () => {
  test("a song added while shuffle is on can be starred, and plays after the next skip", () => {
    let state = playingWith(3, true);
    const [late] = songs("bob", 1);
    if (late === undefined) throw new Error("no song");
    state = apply(state, { type: "add", ownerId: "bob", tracks: [late] });

    // The draw lands on the top of the queue; the star must win over it.
    const after = skip(star(state, late.entryId), 0);

    expect(currentId(after)).toBe(late.entryId);
    expect(after.starred).toEqual([]);
  });

  test.each([
    ["skipped", (state: RoomState) => ({ type: "skip" as const, entryId: currentId(state) })],
    ["removed", (state: RoomState) => ({ type: "remove" as const, entryId: currentId(state) })],
    ["ended", (state: RoomState) => ({ type: "track_ended" as const, entryId: currentId(state) })],
  ])("the song after one %s is the starred one, not the draw", (_, command) => {
    const state = playingWith(4, true);
    const [first, , third] = firstThree(state);
    const starred = star(state, third);

    const after = apply(starred, command(starred), END, new ScriptedRandom([0]));

    expect(currentId(after)).toBe(third);
    expect(after.queue).not.toContain(third);
    expect(after.queue).toContain(first);
  });

  test("starred songs play in the order they were starred, then the draw picks again", () => {
    let state = playingWith(4, true);
    const [first, second, third] = firstThree(state);
    const fourth = state.queue[3] as string;
    state = star(star(state, third), first);

    expect(state.starred).toEqual([third, first]);
    state = skip(state, 3);
    expect(currentId(state)).toBe(third);
    state = skip(state, 3);
    expect(currentId(state)).toBe(first);
    expect(state.starred).toEqual([]);

    // Only the two never starred are left; a draw of 0 takes the first of them.
    state = skip(state, 0);
    expect(currentId(state)).toBe(second);
    expect(state.queue).toEqual([fourth]);
  });

  test("starring a starred song, or unstarring one that is not starred, changes nothing", () => {
    const state = playingWith(3, true);
    const [first, second] = firstThree(state);
    const starred = star(state, first);

    expect(decide(starred, { type: "star", entryId: first, on: true }, context())).toEqual({
      kind: "accepted",
      events: [],
    });
    expect(decide(starred, { type: "star", entryId: second, on: false }, context())).toEqual({
      kind: "accepted",
      events: [],
    });
  });

  test("unstarring a song puts it back in the draw", () => {
    const state = playingWith(3, true);
    const [first, , third] = firstThree(state);

    const unstarred = star(star(state, third), third, false);

    expect(unstarred.starred).toEqual([]);
    expect(currentId(skip(unstarred, 0))).toBe(first);
  });

  test("a song that is playing or gone cannot be starred: the sender saw an older room", () => {
    const state = playingWith(2, true);

    for (const entryId of [currentId(state), "ghost"]) {
      expect(decide(state, { type: "star", entryId, on: true }, context())).toEqual({
        kind: "rejected",
        code: "stale",
      });
    }
  });

  test("while shuffle is off nothing can be starred: the sender saw it on", () => {
    const state = playingWith(2, false);
    const [first] = state.queue;

    expect(decide(state, { type: "star", entryId: first as string, on: true }, context())).toEqual({
      kind: "rejected",
      code: "stale",
    });
  });

  test("shuffling the queue keeps the stars, in the order they were starred", () => {
    let state = playingWith(4, true);
    const [first, , third] = firstThree(state);
    state = star(star(state, third), first);

    const shuffled = apply(state, { type: "shuffle" }, NOW, new ScriptedRandom([1, 2, 0]));

    expect(shuffled.queue).not.toEqual(state.queue);
    expect(shuffled.starred).toEqual([third, first]);
  });

  test("removing or clearing a starred song takes its star with it", () => {
    let state = playingWith(3, true);
    const [first, second, third] = firstThree(state);
    state = star(star(state, second), third);

    state = apply(state, { type: "remove", entryId: second });
    expect(state.starred).toEqual([third]);

    state = apply(state, { type: "clear", addedUpTo: NOW });
    expect(state.queue).toEqual([]);
    expect(state.starred).toEqual([]);
    expect(state.entries[first]).toBeUndefined();
  });
});

describe("stars while shuffle is off", () => {
  test("wait unused: the top of the queue plays, and shuffle on again plays the star", () => {
    let state = playingWith(4, true);
    const [first, second, third] = firstThree(state);
    state = star(state, third);
    state = apply(state, { type: "set_shuffle", on: false });

    expect(state.starred).toEqual([third]);
    state = skip(state, 2);
    expect(currentId(state)).toBe(first);
    expect(state.starred).toEqual([third]);

    state = apply(state, { type: "set_shuffle", on: true });
    state = skip(state, 0);
    expect(currentId(state)).toBe(third);
    expect(state.queue[0]).toBe(second);
  });

  test("a starred song that plays in its turn while shuffle is off loses its star", () => {
    let state = playingWith(3, true);
    const [first] = firstThree(state);
    state = apply(star(state, first), { type: "set_shuffle", on: false });

    state = skip(state, 0);

    expect(currentId(state)).toBe(first);
    expect(state.starred).toEqual([]);
  });
});

describe("stars and repeat", () => {
  test("repeat one replays the song that ended, and the star waits for a skip", () => {
    let state = playingWith(3, true);
    const playing = currentId(state);
    const [, second] = firstThree(state);
    state = apply(star(state, second), { type: "repeat", mode: "one" });

    const after = apply(state, { type: "track_ended", entryId: playing }, END);

    expect(currentId(after)).toBe(playing);
    expect(after.starred).toEqual([second]);
    expect(currentId(skip(after, 0))).toBe(second);
  });

  test("repeat all plays the star and re-queues the song that ended without one", () => {
    let state = playingWith(3, true);
    const played = currentId(state);
    const [, second] = firstThree(state);
    state = apply(star(state, second), { type: "repeat", mode: "all" });

    const after = apply(state, { type: "track_ended", entryId: played }, END);

    expect(currentId(after)).toBe(second);
    expect(after.queue).toContain(played);
    expect(after.starred).toEqual([]);
  });
});
