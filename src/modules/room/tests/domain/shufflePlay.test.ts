import { describe, expect, test } from "bun:test";
import { decide } from "@/modules/room/domain/decide.ts";
import { commit } from "@/modules/room/domain/evolve.ts";
import { emptyRoom, type RoomState } from "@/modules/room/domain/RoomState.ts";
import {
  apply,
  context,
  NOW,
  ScriptedRandom,
  SeededRandom,
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
const END = NOW + SONG_MS + 1000;

describe("shuffle switch", () => {
  test("turns on and off for the whole room, and setting it again changes nothing", () => {
    const on = apply(emptyRoom(), { type: "set_shuffle", on: true });

    expect(on.shuffle).toBe(true);
    expect(apply(on, { type: "set_shuffle", on: false }).shuffle).toBe(false);
    expect(decide(on, { type: "set_shuffle", on: true }, context())).toEqual({
      kind: "accepted",
      events: [],
    });
  });

  test.each([
    ["skipped", (state: RoomState) => ({ type: "skip" as const, entryId: currentId(state) })],
    ["removed", (state: RoomState) => ({ type: "remove" as const, entryId: currentId(state) })],
    ["ended", (state: RoomState) => ({ type: "track_ended" as const, entryId: currentId(state) })],
  ])("the song after one %s is drawn at random from the queue", (_, command) => {
    const state = playingWith(4, true);
    const [first, second, third, fourth] = state.queue;

    const after = apply(state, command(state), END, new ScriptedRandom([2]));

    expect(currentId(after)).toBe(third as string);
    expect<(string | undefined)[]>(after.queue).toEqual([first, second, fourth]);
  });

  test("with shuffle off the same draw is ignored and the top of the queue plays", () => {
    const state = playingWith(4, false);
    const [first] = state.queue;

    const after = apply(
      state,
      { type: "skip", entryId: currentId(state) },
      NOW,
      new ScriptedRandom([2]),
    );

    expect(currentId(after)).toBe(first as string);
  });

  test("turning shuffle off plays the queue from the top again", () => {
    let state = playingWith(4, true);
    const [first] = state.queue;
    state = apply(state, { type: "set_shuffle", on: false });

    const after = apply(
      state,
      { type: "skip", entryId: currentId(state) },
      NOW,
      new ScriptedRandom([3]),
    );

    expect(currentId(after)).toBe(first as string);
  });

  test("an idle room given songs under shuffle starts on a random one of them", () => {
    const tracks = songs("ada", 4);
    const on = apply(emptyRoom(), { type: "set_shuffle", on: true });

    const state = apply(on, { type: "add", ownerId: "ada", tracks }, NOW, new ScriptedRandom([2]));

    expect(currentId(state)).toBe(tracks[2]?.entryId as string);
    expect<(string | undefined)[]>(state.queue).toEqual(
      [tracks[0], tracks[1], tracks[3]].map((one) => one?.entryId),
    );
  });

  test("with repeat all, the song that just played is not drawn again while another waits", () => {
    let state = playingWith(1, true);
    const played = currentId(state);
    const [waiting] = state.queue;
    state = apply(state, { type: "repeat", mode: "all" });

    // The highest draw there is: it would land on the re-queued song if that were in the pool.
    const after = apply(
      state,
      { type: "track_ended", entryId: played },
      END,
      new ScriptedRandom([99]),
    );

    expect(currentId(after)).toBe(waiting as string);
    expect(after.queue).toEqual([played]);
  });

  test("with repeat all and nothing else queued, the one song plays on", () => {
    let state = apply(emptyRoom(), { type: "add", ownerId: "ada", tracks: songs("ada", 1) });
    const only = currentId(state);
    state = apply(state, { type: "repeat", mode: "all" });
    state = apply(state, { type: "set_shuffle", on: true });

    const after = apply(state, { type: "track_ended", entryId: only }, END);

    expect(currentId(after)).toBe(only);
    expect(after.queue).toEqual([]);
  });

  test("with repeat one, the song that ended plays again whatever the draw", () => {
    let state = playingWith(3, true);
    const playing = currentId(state);
    state = apply(state, { type: "repeat", mode: "one" });

    const after = apply(
      state,
      { type: "track_ended", entryId: playing },
      END,
      new ScriptedRandom([2]),
    );

    expect(currentId(after)).toBe(playing);
  });

  test("over many rooms, every waiting song gets drawn first, not just the top one", () => {
    const drawn = new Map<number, number>();

    for (let seed = 1; seed <= 200; seed += 1) {
      const state = playingWith(5, true);
      const after = apply(
        state,
        { type: "skip", entryId: currentId(state) },
        NOW,
        new SeededRandom(seed),
      );
      const place = state.queue.indexOf(currentId(after));
      drawn.set(place, (drawn.get(place) ?? 0) + 1);
    }

    expect([...drawn.keys()].sort()).toEqual([0, 1, 2, 3, 4]);
    for (const count of drawn.values()) expect(count).toBeGreaterThan(20);
  });

  test("an advance naming a song that is not queued is a bug, not something to guess around", () => {
    const state = playingWith(2, true);

    expect(() =>
      commit(state, [{ type: "advanced", reason: "skipped", next: "ghost", at: NOW }]),
    ).toThrow("not queued");
  });
});
